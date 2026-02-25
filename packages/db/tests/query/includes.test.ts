import { beforeEach, describe, expect, it } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
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
function toTree(collection: any, sortKey = `id`): Array<any> {
  const rows = [...collection.toArray].sort(
    (a: any, b: any) => a[sortKey] - b[sortKey],
  )
  return rows.map((row: any) => {
    const out: Record<string, any> = {}
    for (const [key, value] of Object.entries(row)) {
      out[key] =
        value && typeof value === `object` && `toArray` in (value as any)
          ? toTree(value, sortKey)
          : value
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

  describe(`nested includes`, () => {
    it(`supports two levels of includes`, async () => {
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
  })
})
