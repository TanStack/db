import { beforeEach, describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

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

const sampleProjects: Array<Project> = [
  { id: 1, name: `Alpha` },
  { id: 2, name: `Beta` },
  { id: 3, name: `Gamma` },
]

const sampleIssues: Array<Issue> = [
  { id: 10, projectId: 1, title: `Bug in Alpha` },
  { id: 11, projectId: 1, title: `Feature for Alpha` },
  { id: 20, projectId: 2, title: `Bug in Beta` },
  // No issues for project 3
]

const sampleComments: Array<Comment> = [
  { id: 100, issueId: 10, body: `Looks bad` },
  { id: 101, issueId: 10, body: `Fixed it` },
  { id: 200, issueId: 20, body: `Same bug` },
  // No comments for issue 11
]

function createProjectsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Project>({
      id: `includes-projects`,
      getKey: (p) => p.id,
      initialData: sampleProjects,
    }),
  )
}

function createIssuesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `includes-issues`,
      getKey: (i) => i.id,
      initialData: sampleIssues,
    }),
  )
}

function createCommentsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Comment>({
      id: `includes-comments`,
      getKey: (c) => c.id,
      initialData: sampleComments,
    }),
  )
}

/**
 * Extracts child collection items as a sorted plain array for comparison.
 */
function childItems(collection: any, sortKey = `id`): Array<any> {
  return [...collection.toArray].sort(
    (a: any, b: any) => a[sortKey] - b[sortKey],
  )
}

/**
 * Recursively converts a live query collection (or child Collection) into a
 * plain sorted array, turning any nested child Collections into nested arrays.
 * This lets tests compare the full hierarchical result as a single literal.
 */
function toTree(collectionOrArray: any, sortKey = `id`): Array<any> {
  const rows = (
    Array.isArray(collectionOrArray)
      ? [...collectionOrArray]
      : [...collectionOrArray.toArray]
  ).sort((a: any, b: any) => a[sortKey] - b[sortKey])
  return rows.map((row: any) => {
    if (typeof row !== `object` || row === null) return row
    const out: Record<string, any> = {}
    for (const [key, value] of Object.entries(row)) {
      if (Array.isArray(value)) {
        out[key] = toTree(value, sortKey)
      } else if (
        value &&
        typeof value === `object` &&
        `toArray` in (value as any)
      ) {
        out[key] = toTree(value, sortKey)
      } else {
        out[key] = value
      }
    }
    return out
  })
}

describe(`includes subqueries`, () => {
  let projects: ReturnType<typeof createProjectsCollection>
  let issues: ReturnType<typeof createIssuesCollection>
  let comments: ReturnType<typeof createCommentsCollection>

  beforeEach(() => {
    projects = createProjectsCollection()
    issues = createIssuesCollection()
    comments = createCommentsCollection()
  })

  function buildIncludesQuery() {
    return createLiveQueryCollection((q) =>
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
  }

  describe(`basic includes`, () => {
    it(`produces child Collections on parent rows`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            { id: 10, title: `Bug in Alpha` },
            { id: 11, title: `Feature for Alpha` },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [{ id: 20, title: `Bug in Beta` }],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })
  })

  describe(`reactivity`, () => {
    it(`adding a child updates the parent's child collection`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(childItems((collection.get(1) as any).issues)).toHaveLength(2)

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `New Alpha issue` },
      })
      issues.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])
    })

    it(`removing a child updates the parent's child collection`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(childItems((collection.get(1) as any).issues)).toHaveLength(2)

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 10)!,
      })
      issues.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 11, title: `Feature for Alpha` },
      ])
    })

    it(`removing and re-adding a parent resets its child collection`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(childItems((collection.get(1) as any).issues)).toHaveLength(2)

      // Remove project Alpha
      projects.utils.begin()
      projects.utils.write({
        type: `delete`,
        value: sampleProjects.find((p) => p.id === 1)!,
      })
      projects.utils.commit()

      expect(collection.get(1)).toBeUndefined()

      // Re-add project Alpha — should get a fresh child collection
      projects.utils.begin()
      projects.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alpha Reborn` },
      })
      projects.utils.commit()

      const alpha = collection.get(1) as any
      expect(alpha).toMatchObject({ id: 1, name: `Alpha Reborn` })
      expect(childItems(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      // New children should flow into the child collection
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 99, projectId: 1, title: `Post-rebirth issue` },
      })
      issues.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 99, title: `Post-rebirth issue` },
      ])
    })

    it(`adding a child to a previously empty parent works`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(childItems((collection.get(3) as any).issues)).toEqual([])

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      expect(childItems((collection.get(3) as any).issues)).toEqual([
        { id: 30, title: `Gamma issue` },
      ])
    })
  })

  describe(`inner join filtering`, () => {
    it(`only shows children for parents matching a WHERE clause`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q
          .from({ p: projects })
          .where(({ p }) => eq(p.name, `Alpha`))
          .select(({ p }) => ({
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

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            { id: 10, title: `Bug in Alpha` },
            { id: 11, title: `Feature for Alpha` },
          ],
        },
      ])
    })
  })

  describe(`ordered child queries`, () => {
    it(`child collection respects orderBy on the child query`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .orderBy(({ i }) => i.title, `desc`)
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
        })),
      )

      await collection.preload()

      // Alpha's issues should be sorted by title descending:
      // "Feature for Alpha" before "Bug in Alpha"
      const alpha = collection.get(1) as any
      const alphaIssues = [...alpha.issues.toArray]
      expect(alphaIssues).toEqual([
        { id: 11, title: `Feature for Alpha` },
        { id: 10, title: `Bug in Alpha` },
      ])

      // Beta has one issue, order doesn't matter but it should still work
      const beta = collection.get(2) as any
      const betaIssues = [...beta.issues.toArray]
      expect(betaIssues).toEqual([{ id: 20, title: `Bug in Beta` }])

      // Gamma has no issues
      const gamma = collection.get(3) as any
      expect([...gamma.issues.toArray]).toEqual([])
    })

    it(`newly inserted children appear in the correct order`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .orderBy(({ i }) => i.title, `asc`)
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
        })),
      )

      await collection.preload()

      // Alpha issues sorted ascending: "Bug in Alpha", "Feature for Alpha"
      expect([...(collection.get(1) as any).issues.toArray]).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      // Insert an issue that should appear between the existing two
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `Docs for Alpha` },
      })
      issues.utils.commit()

      // Should maintain ascending order: Bug, Docs, Feature
      expect([...(collection.get(1) as any).issues.toArray]).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 12, title: `Docs for Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])
    })
  })

  describe(`ordered child queries with limit`, () => {
    it(`limits child collection to N items per parent`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .orderBy(({ i }) => i.title, `asc`)
            .limit(1)
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
        })),
      )

      await collection.preload()

      // Alpha has 2 issues; limit(1) with asc title should keep only "Bug in Alpha"
      const alpha = collection.get(1) as any
      expect([...alpha.issues.toArray]).toEqual([
        { id: 10, title: `Bug in Alpha` },
      ])

      // Beta has 1 issue; limit(1) keeps it
      const beta = collection.get(2) as any
      expect([...beta.issues.toArray]).toEqual([
        { id: 20, title: `Bug in Beta` },
      ])

      // Gamma has 0 issues; limit(1) still empty
      const gamma = collection.get(3) as any
      expect([...gamma.issues.toArray]).toEqual([])
    })

    it(`inserting a child that displaces an existing one respects the limit`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .orderBy(({ i }) => i.title, `asc`)
            .limit(1)
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
            })),
        })),
      )

      await collection.preload()

      // Alpha should have exactly 1 issue (limit 1): "Bug in Alpha"
      const alphaIssues = [...(collection.get(1) as any).issues.toArray]
      expect(alphaIssues).toHaveLength(1)
      expect(alphaIssues).toEqual([{ id: 10, title: `Bug in Alpha` }])

      // Insert an issue that comes before "Bug" alphabetically
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `Alpha priority issue` },
      })
      issues.utils.commit()

      // The new issue should displace "Bug in Alpha" since it sorts first
      expect([...(collection.get(1) as any).issues.toArray]).toEqual([
        { id: 12, title: `Alpha priority issue` },
      ])

      // Beta should still have its 1 issue (limit is per-parent)
      expect([...(collection.get(2) as any).issues.toArray]).toEqual([
        { id: 20, title: `Bug in Beta` },
      ])
    })
  })

  // Nested includes: two-level parent → child → grandchild (Project → Issue → Comment).
  // Each level (Issue/Comment) can be materialized as a live Collection or a plain array (via toArray).
  // We test all four combinations:
  //   Collection → Collection  — both levels are live Collections
  //   Collection → toArray     — issues are Collections, comments are arrays
  //   toArray → Collection     — issues are arrays, comments are Collections
  //   toArray → toArray        — both levels are plain arrays
  describe(`nested includes: Collection → Collection`, () => {
    function buildNestedQuery() {
      return createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
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
    }

    it(`supports two levels of includes`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            {
              id: 11,
              title: `Feature for Alpha`,
              comments: [],
            },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`adding a grandchild (comment) updates the nested child collection`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      // Issue 11 (Feature for Alpha) has no comments initially
      const alpha = collection.get(1) as any
      const issue11 = alpha.issues.get(11)
      expect(childItems(issue11.comments)).toEqual([])

      // Add a comment to issue 11 — no issue or project changes
      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      const issue11After = (collection.get(1) as any).issues.get(11)
      expect(childItems(issue11After.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
    })

    it(`removing a grandchild (comment) updates the nested child collection`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      // Issue 10 (Bug in Alpha) has 2 comments
      const issue10 = (collection.get(1) as any).issues.get(10)
      expect(childItems(issue10.comments)).toHaveLength(2)

      // Remove one comment
      comments.utils.begin()
      comments.utils.write({
        type: `delete`,
        value: sampleComments.find((c) => c.id === 100)!,
      })
      comments.utils.commit()

      const issue10After = (collection.get(1) as any).issues.get(10)
      expect(childItems(issue10After.comments)).toEqual([
        { id: 101, body: `Fixed it` },
      ])
    })

    it(`adding an issue (middle-level insert) creates a child with empty comments`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [{ id: 30, title: `Gamma issue`, comments: [] }],
        },
      ])
    })

    it(`removing an issue (middle-level delete) removes it from the parent`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 11)!,
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`updating an issue title (middle-level update) reflects in the parent`, async () => {
      const collection = buildNestedQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `update`,
        value: { id: 10, projectId: 1, title: `Renamed Bug` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Renamed Bug`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })
  })

  describe(`toArray`, () => {
    function buildToArrayQuery() {
      return createLiveQueryCollection((q) =>
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
    }

    it(`produces arrays on parent rows, not Collections`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)
      expect(alpha.issues.sort((a: any, b: any) => a.id - b.id)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(Array.isArray(beta.issues)).toBe(true)
      expect(beta.issues).toEqual([{ id: 20, title: `Bug in Beta` }])
    })

    it(`empty parents get empty arrays`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      const gamma = collection.get(3) as any
      expect(Array.isArray(gamma.issues)).toBe(true)
      expect(gamma.issues).toEqual([])
    })

    it(`adding a child re-emits the parent with updated array`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `New Alpha issue` },
      })
      issues.utils.commit()

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)
      expect(alpha.issues.sort((a: any, b: any) => a.id - b.id)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])
    })

    it(`removing a child re-emits the parent with updated array`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 10)!,
      })
      issues.utils.commit()

      const alpha = collection.get(1) as any
      expect(alpha.issues).toEqual([{ id: 11, title: `Feature for Alpha` }])
    })

    it(`array respects ORDER BY`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: toArray(
            q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .orderBy(({ i }) => i.title, `asc`)
              .select(({ i }) => ({
                id: i.id,
                title: i.title,
              })),
          ),
        })),
      )

      await collection.preload()

      const alpha = collection.get(1) as any
      expect(alpha.issues).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])
    })

    it(`ordered toArray with limit applied per parent`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: toArray(
            q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .orderBy(({ i }) => i.title, `asc`)
              .limit(1)
              .select(({ i }) => ({
                id: i.id,
                title: i.title,
              })),
          ),
        })),
      )

      await collection.preload()

      const alpha = collection.get(1) as any
      expect(alpha.issues).toEqual([{ id: 10, title: `Bug in Alpha` }])

      const beta = collection.get(2) as any
      expect(beta.issues).toEqual([{ id: 20, title: `Bug in Beta` }])

      const gamma = collection.get(3) as any
      expect(gamma.issues).toEqual([])
    })
  })

  describe(`nested includes: Collection → toArray`, () => {
    function buildCollectionToArrayQuery() {
      return createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
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
        })),
      )
    }

    it(`initial load: issues are Collections, comments are arrays`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      const alpha = collection.get(1) as any
      // issues should be a Collection
      expect(alpha.issues.toArray).toBeDefined()

      const issue10 = alpha.issues.get(10)
      // comments should be an array
      expect(Array.isArray(issue10.comments)).toBe(true)
      expect(issue10.comments.sort((a: any, b: any) => a.id - b.id)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      const issue11 = alpha.issues.get(11)
      expect(Array.isArray(issue11.comments)).toBe(true)
      expect(issue11.comments).toEqual([])
    })

    it(`adding a comment (grandchild-only change) updates the issue's comments array`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      const issue11Before = (collection.get(1) as any).issues.get(11)
      expect(issue11Before.comments).toEqual([])

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      const issue11After = (collection.get(1) as any).issues.get(11)
      expect(Array.isArray(issue11After.comments)).toBe(true)
      expect(issue11After.comments).toEqual([
        { id: 110, body: `Great feature` },
      ])
    })

    it(`removing a comment (grandchild-only change) updates the issue's comments array`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      const issue10Before = (collection.get(1) as any).issues.get(10)
      expect(issue10Before.comments).toHaveLength(2)

      comments.utils.begin()
      comments.utils.write({
        type: `delete`,
        value: sampleComments.find((c) => c.id === 100)!,
      })
      comments.utils.commit()

      const issue10After = (collection.get(1) as any).issues.get(10)
      expect(issue10After.comments).toEqual([{ id: 101, body: `Fixed it` }])
    })

    it(`adding an issue (middle-level insert) creates a child with empty comments array`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [{ id: 30, title: `Gamma issue`, comments: [] }],
        },
      ])
    })

    it(`removing an issue (middle-level delete) removes it from the parent`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 11)!,
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`updating an issue title (middle-level update) reflects in the parent`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `update`,
        value: { id: 10, projectId: 1, title: `Renamed Bug` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Renamed Bug`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })
  })

  describe(`nested includes: toArray → Collection`, () => {
    function buildToArrayToCollectionQuery() {
      return createLiveQueryCollection((q) =>
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
                comments: q
                  .from({ c: comments })
                  .where(({ c }) => eq(c.issueId, i.id))
                  .select(({ c }) => ({
                    id: c.id,
                    body: c.body,
                  })),
              })),
          ),
        })),
      )
    }

    it(`initial load: issues are arrays, comments are Collections`, async () => {
      const collection = buildToArrayToCollectionQuery()
      await collection.preload()

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)

      const sortedIssues = alpha.issues.sort((a: any, b: any) => a.id - b.id)
      // comments should be Collections
      expect(sortedIssues[0].comments.toArray).toBeDefined()
      expect(childItems(sortedIssues[0].comments)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      expect(sortedIssues[1].comments.toArray).toBeDefined()
      expect(childItems(sortedIssues[1].comments)).toEqual([])
    })

    it(`adding a comment updates the nested Collection (live reference)`, async () => {
      const collection = buildToArrayToCollectionQuery()
      await collection.preload()

      const alpha = collection.get(1) as any
      const issue11 = alpha.issues.find((i: any) => i.id === 11)
      expect(childItems(issue11.comments)).toEqual([])

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      // The Collection reference on the issue object is live
      expect(childItems(issue11.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
    })

    it(`adding an issue re-emits the parent with updated array including nested Collection`, async () => {
      const collection = buildToArrayToCollectionQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      const gamma = collection.get(3) as any
      expect(Array.isArray(gamma.issues)).toBe(true)
      expect(gamma.issues).toHaveLength(1)
      expect(gamma.issues[0].id).toBe(30)
      expect(gamma.issues[0].comments.toArray).toBeDefined()
      expect(childItems(gamma.issues[0].comments)).toEqual([])
    })

    it(`removing an issue re-emits the parent with updated array`, async () => {
      const collection = buildToArrayToCollectionQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 11)!,
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`updating an issue title re-emits the parent with updated array`, async () => {
      const collection = buildToArrayToCollectionQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `update`,
        value: { id: 10, projectId: 1, title: `Renamed Bug` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Renamed Bug`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })
  })

  describe(`nested includes: toArray → toArray`, () => {
    function buildToArrayToArrayQuery() {
      return createLiveQueryCollection((q) =>
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
    }

    it(`initial load: both levels are arrays`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)

      const sortedIssues = alpha.issues.sort((a: any, b: any) => a.id - b.id)
      expect(Array.isArray(sortedIssues[0].comments)).toBe(true)
      expect(
        sortedIssues[0].comments.sort((a: any, b: any) => a.id - b.id),
      ).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      expect(sortedIssues[1].comments).toEqual([])
    })

    it(`adding a comment (grandchild-only change) updates both array levels`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)
      const issue11 = alpha.issues.find((i: any) => i.id === 11)
      expect(Array.isArray(issue11.comments)).toBe(true)
      expect(issue11.comments).toEqual([{ id: 110, body: `Great feature` }])
    })

    it(`removing a comment (grandchild-only change) updates both array levels`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      comments.utils.begin()
      comments.utils.write({
        type: `delete`,
        value: sampleComments.find((c) => c.id === 100)!,
      })
      comments.utils.commit()

      const alpha = collection.get(1) as any
      const issue10 = alpha.issues.find((i: any) => i.id === 10)
      expect(issue10.comments).toEqual([{ id: 101, body: `Fixed it` }])
    })

    it(`adding an issue (middle-level insert) re-emits parent with updated array`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [{ id: 30, title: `Gamma issue`, comments: [] }],
        },
      ])
    })

    it(`removing an issue (middle-level delete) re-emits parent with updated array`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `delete`,
        value: sampleIssues.find((i) => i.id === 11)!,
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Bug in Alpha`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`updating an issue title (middle-level update) re-emits parent with updated array`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      issues.utils.begin()
      issues.utils.write({
        type: `update`,
        value: { id: 10, projectId: 1, title: `Renamed Bug` },
      })
      issues.utils.commit()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          issues: [
            {
              id: 10,
              title: `Renamed Bug`,
              comments: [
                { id: 100, body: `Looks bad` },
                { id: 101, body: `Fixed it` },
              ],
            },
            { id: 11, title: `Feature for Alpha`, comments: [] },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [
            {
              id: 20,
              title: `Bug in Beta`,
              comments: [{ id: 200, body: `Same bug` }],
            },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
        },
      ])
    })

    it(`concurrent child + grandchild changes in the same transaction`, async () => {
      const collection = buildToArrayToArrayQuery()
      await collection.preload()

      // Add a new issue AND a comment on an existing issue in one transaction
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 30, projectId: 3, title: `Gamma issue` },
      })
      issues.utils.commit()

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      // Gamma should have the new issue with empty comments
      const gamma = collection.get(3) as any
      expect(gamma.issues).toHaveLength(1)
      expect(gamma.issues[0].id).toBe(30)
      expect(gamma.issues[0].comments).toEqual([])

      // Alpha's issue 11 should have the new comment
      const alpha = collection.get(1) as any
      const issue11 = alpha.issues.find((i: any) => i.id === 11)
      expect(issue11.comments).toEqual([{ id: 110, body: `Great feature` }])
    })
  })
})
