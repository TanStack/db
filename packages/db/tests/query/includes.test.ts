import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  and,
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

    it(`spread select on child does not leak internal properties`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({
              ...i,
            })),
        })),
      )

      await collection.preload()

      const alpha = collection.get(1) as any
      const childIssues = childItems(alpha.issues)
      // Should contain only the real Issue fields, no internal __correlationKey
      expect(childIssues[0]).toEqual({
        id: 10,
        projectId: 1,
        title: `Bug in Alpha`,
      })
      expect(childIssues[0]).not.toHaveProperty(`__correlationKey`)
      expect(childIssues[0]).not.toHaveProperty(`__parentContext`)
    })
  })

  describe(`change propagation`, () => {
    it(`Collection includes: child change does not re-emit the parent row`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      const changeCallback = vi.fn()
      const subscription = collection.subscribeChanges(changeCallback, {
        includeInitialState: false,
      })
      changeCallback.mockClear()

      // Add a child issue to project Alpha
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `New Alpha issue` },
      })
      issues.utils.commit()

      // Wait for async change propagation
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The child Collection updates in place — the parent row should NOT be re-emitted
      expect(changeCallback).not.toHaveBeenCalled()

      // But the child data is there
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])

      subscription.unsubscribe()
    })

    it(`toArray includes: child change re-emits the parent row`, async () => {
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

      await collection.preload()

      const changeCallback = vi.fn()
      const subscription = collection.subscribeChanges(changeCallback, {
        includeInitialState: false,
      })
      changeCallback.mockClear()

      // Add a child issue to project Alpha
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `New Alpha issue` },
      })
      issues.utils.commit()

      // Wait for async change propagation
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The parent row SHOULD be re-emitted with the updated array
      expect(changeCallback).toHaveBeenCalled()

      // Verify the parent row has the updated array
      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)
      expect(alpha.issues.sort((a: any, b: any) => a.id - b.id)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])

      subscription.unsubscribe()
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

  describe(`shared correlation key`, () => {
    // Multiple parents share the same correlationKey value.
    // e.g., two teams in the same department — both should see the same department members.
    type Team = { id: number; name: string; departmentId: number }
    type Member = { id: number; departmentId: number; name: string }

    const sampleTeams: Array<Team> = [
      { id: 1, name: `Frontend`, departmentId: 100 },
      { id: 2, name: `Backend`, departmentId: 100 },
      { id: 3, name: `Marketing`, departmentId: 200 },
    ]

    const sampleMembers: Array<Member> = [
      { id: 10, departmentId: 100, name: `Alice` },
      { id: 11, departmentId: 100, name: `Bob` },
      { id: 20, departmentId: 200, name: `Charlie` },
    ]

    function createTeamsCollection() {
      return createCollection(
        mockSyncCollectionOptions<Team>({
          id: `includes-teams`,
          getKey: (t) => t.id,
          initialData: sampleTeams,
        }),
      )
    }

    function createMembersCollection() {
      return createCollection(
        mockSyncCollectionOptions<Member>({
          id: `includes-members`,
          getKey: (m) => m.id,
          initialData: sampleMembers,
        }),
      )
    }

    it(`multiple parents with the same correlationKey each get the shared children`, async () => {
      const teams = createTeamsCollection()
      const members = createMembersCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ t: teams }).select(({ t }) => ({
          id: t.id,
          name: t.name,
          departmentId: t.departmentId,
          members: q
            .from({ m: members })
            .where(({ m }) => eq(m.departmentId, t.departmentId))
            .select(({ m }) => ({
              id: m.id,
              name: m.name,
            })),
        })),
      )

      await collection.preload()

      // Both Frontend and Backend teams share departmentId 100
      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Frontend`,
          departmentId: 100,
          members: [
            { id: 10, name: `Alice` },
            { id: 11, name: `Bob` },
          ],
        },
        {
          id: 2,
          name: `Backend`,
          departmentId: 100,
          members: [
            { id: 10, name: `Alice` },
            { id: 11, name: `Bob` },
          ],
        },
        {
          id: 3,
          name: `Marketing`,
          departmentId: 200,
          members: [{ id: 20, name: `Charlie` }],
        },
      ])
    })

    it(`adding a child updates all parents that share the correlation key`, async () => {
      const teams = createTeamsCollection()
      const members = createMembersCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ t: teams }).select(({ t }) => ({
          id: t.id,
          name: t.name,
          departmentId: t.departmentId,
          members: q
            .from({ m: members })
            .where(({ m }) => eq(m.departmentId, t.departmentId))
            .select(({ m }) => ({
              id: m.id,
              name: m.name,
            })),
        })),
      )

      await collection.preload()

      // Add a new member to department 100
      members.utils.begin()
      members.utils.write({
        type: `insert`,
        value: { id: 12, departmentId: 100, name: `Dave` },
      })
      members.utils.commit()

      // Both Frontend and Backend should see the new member
      expect(childItems((collection.get(1) as any).members)).toEqual([
        { id: 10, name: `Alice` },
        { id: 11, name: `Bob` },
        { id: 12, name: `Dave` },
      ])
      expect(childItems((collection.get(2) as any).members)).toEqual([
        { id: 10, name: `Alice` },
        { id: 11, name: `Bob` },
        { id: 12, name: `Dave` },
      ])

      // Marketing unaffected
      expect(childItems((collection.get(3) as any).members)).toEqual([
        { id: 20, name: `Charlie` },
      ])
    })

    it(`deleting one parent preserves sibling parent's child collection`, async () => {
      const teams = createTeamsCollection()
      const members = createMembersCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ t: teams }).select(({ t }) => ({
          id: t.id,
          name: t.name,
          departmentId: t.departmentId,
          members: q
            .from({ m: members })
            .where(({ m }) => eq(m.departmentId, t.departmentId))
            .select(({ m }) => ({
              id: m.id,
              name: m.name,
            })),
        })),
      )

      await collection.preload()

      // Both Frontend and Backend share departmentId 100
      expect(childItems((collection.get(1) as any).members)).toHaveLength(2)
      expect(childItems((collection.get(2) as any).members)).toHaveLength(2)

      // Delete the Frontend team
      teams.utils.begin()
      teams.utils.write({
        type: `delete`,
        value: sampleTeams[0]!,
      })
      teams.utils.commit()

      expect(collection.get(1)).toBeUndefined()

      // Backend should still have its child collection with all members
      expect(childItems((collection.get(2) as any).members)).toEqual([
        { id: 10, name: `Alice` },
        { id: 11, name: `Bob` },
      ])
    })

    it(`correlation field does not need to be in the parent select`, async () => {
      const teams = createTeamsCollection()
      const members = createMembersCollection()

      // departmentId is used for correlation but NOT selected in the parent output
      const collection = createLiveQueryCollection((q) =>
        q.from({ t: teams }).select(({ t }) => ({
          id: t.id,
          name: t.name,
          members: q
            .from({ m: members })
            .where(({ m }) => eq(m.departmentId, t.departmentId))
            .select(({ m }) => ({
              id: m.id,
              name: m.name,
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Frontend`,
          members: [
            { id: 10, name: `Alice` },
            { id: 11, name: `Bob` },
          ],
        },
        {
          id: 2,
          name: `Backend`,
          members: [
            { id: 10, name: `Alice` },
            { id: 11, name: `Bob` },
          ],
        },
        {
          id: 3,
          name: `Marketing`,
          members: [{ id: 20, name: `Charlie` }],
        },
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

  describe(`parent-referencing filters`, () => {
    type ProjectWithCreator = {
      id: number
      name: string
      createdBy: string
    }

    type IssueWithCreator = {
      id: number
      projectId: number
      title: string
      createdBy: string
    }

    const sampleProjectsWithCreator: Array<ProjectWithCreator> = [
      { id: 1, name: `Alpha`, createdBy: `alice` },
      { id: 2, name: `Beta`, createdBy: `bob` },
      { id: 3, name: `Gamma`, createdBy: `alice` },
    ]

    const sampleIssuesWithCreator: Array<IssueWithCreator> = [
      { id: 10, projectId: 1, title: `Bug in Alpha`, createdBy: `alice` },
      { id: 11, projectId: 1, title: `Feature for Alpha`, createdBy: `bob` },
      { id: 20, projectId: 2, title: `Bug in Beta`, createdBy: `bob` },
      { id: 21, projectId: 2, title: `Feature for Beta`, createdBy: `alice` },
      { id: 30, projectId: 3, title: `Bug in Gamma`, createdBy: `alice` },
    ]

    function createProjectsWC() {
      return createCollection(
        mockSyncCollectionOptions<ProjectWithCreator>({
          id: `includes-projects-wc`,
          getKey: (p) => p.id,
          initialData: sampleProjectsWithCreator,
        }),
      )
    }

    function createIssuesWC() {
      return createCollection(
        mockSyncCollectionOptions<IssueWithCreator>({
          id: `includes-issues-wc`,
          getKey: (i) => i.id,
          initialData: sampleIssuesWithCreator,
        }),
      )
    }

    let projectsWC: ReturnType<typeof createProjectsWC>
    let issuesWC: ReturnType<typeof createIssuesWC>

    beforeEach(() => {
      projectsWC = createProjectsWC()
      issuesWC = createIssuesWC()
    })

    it(`filters children by parent-referencing eq()`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) => eq(i.projectId, p.id))
            .where(({ i }) => eq(i.createdBy, p.createdBy))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          createdBy: `alice`,
          issues: [
            // Only issue 10 (createdBy: alice) matches project 1 (createdBy: alice)
            { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          createdBy: `bob`,
          issues: [
            // Only issue 20 (createdBy: bob) matches project 2 (createdBy: bob)
            { id: 20, title: `Bug in Beta`, createdBy: `bob` },
          ],
        },
        {
          id: 3,
          name: `Gamma`,
          createdBy: `alice`,
          issues: [
            // Only issue 30 (createdBy: alice) matches project 3 (createdBy: alice)
            { id: 30, title: `Bug in Gamma`, createdBy: `alice` },
          ],
        },
      ])
    })

    it(`reacts to parent field change`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) => eq(i.projectId, p.id))
            .where(({ i }) => eq(i.createdBy, p.createdBy))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      // Project 1 (createdBy: alice) → only issue 10 (alice)
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
      ])

      // Change project 1 createdBy from alice to bob
      projectsWC.utils.begin()
      projectsWC.utils.write({
        type: `update`,
        value: { id: 1, name: `Alpha`, createdBy: `bob` },
        oldValue: sampleProjectsWithCreator[0]!,
      })
      projectsWC.utils.commit()

      // Now issue 11 (createdBy: bob) should match, issue 10 (alice) should not
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 11, title: `Feature for Alpha`, createdBy: `bob` },
      ])
    })

    it(`reacts to child field change`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) => eq(i.projectId, p.id))
            .where(({ i }) => eq(i.createdBy, p.createdBy))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      // Project 1 (alice) → only issue 10
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
      ])

      // Change issue 11's createdBy from bob to alice → it should now appear
      issuesWC.utils.begin()
      issuesWC.utils.write({
        type: `update`,
        value: {
          id: 11,
          projectId: 1,
          title: `Feature for Alpha`,
          createdBy: `alice`,
        },
        oldValue: sampleIssuesWithCreator[1]!,
      })
      issuesWC.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
        { id: 11, title: `Feature for Alpha`, createdBy: `alice` },
      ])
    })

    it(`mixed filters: parent-referencing + pure-child`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) => eq(i.projectId, p.id))
            .where(({ i }) => eq(i.createdBy, p.createdBy))
            .where(({ i }) => eq(i.title, `Bug in Alpha`))
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      // Project 1 (alice): matching createdBy + title = only issue 10
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
      ])

      // Project 2 (bob): no issues with title "Bug in Alpha"
      expect(childItems((collection.get(2) as any).issues)).toEqual([])

      // Project 3 (alice): no issues with title "Bug in Alpha"
      expect(childItems((collection.get(3) as any).issues)).toEqual([])
    })

    it(`extracts correlation from and() with a pure-child filter`, async () => {
      // and(correlation, childFilter) in a single .where() — no parent ref
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) =>
              and(eq(i.projectId, p.id), eq(i.createdBy, `alice`)),
            )
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
          issues: [{ id: 10, title: `Bug in Alpha` }],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [{ id: 21, title: `Feature for Beta` }],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [{ id: 30, title: `Bug in Gamma` }],
        },
      ])
    })

    it(`reactivity works when correlation is inside and()`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) =>
              and(eq(i.projectId, p.id), eq(i.createdBy, p.createdBy)),
            )
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
      ])

      // Change project 1 createdBy from alice to bob → issue 11 should match instead
      projectsWC.utils.begin()
      projectsWC.utils.write({
        type: `update`,
        value: { id: 1, name: `Alpha`, createdBy: `bob` },
        oldValue: sampleProjectsWithCreator[0]!,
      })
      projectsWC.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 11, title: `Feature for Alpha`, createdBy: `bob` },
      ])
    })

    it(`extracts correlation from inside and()`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) =>
              and(eq(i.projectId, p.id), eq(i.createdBy, p.createdBy)),
            )
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          name: `Alpha`,
          createdBy: `alice`,
          issues: [{ id: 10, title: `Bug in Alpha`, createdBy: `alice` }],
        },
        {
          id: 2,
          name: `Beta`,
          createdBy: `bob`,
          issues: [{ id: 20, title: `Bug in Beta`, createdBy: `bob` }],
        },
        {
          id: 3,
          name: `Gamma`,
          createdBy: `alice`,
          issues: [{ id: 30, title: `Bug in Gamma`, createdBy: `alice` }],
        },
      ])
    })

    it(`produces distinct child sets when parents share a correlation key but differ in filtered parent fields`, async () => {
      // Two parents share the same groupId (correlation key) but have different
      // createdBy values. The parent-referencing filter on createdBy must
      // produce separate child results per parent, not a shared union.
      type GroupParent = {
        id: number
        groupId: number
        createdBy: string
      }

      type GroupChild = {
        id: number
        groupId: number
        createdBy: string
      }

      const parents = createCollection(
        mockSyncCollectionOptions<GroupParent>({
          id: `shared-corr-parents`,
          getKey: (p) => p.id,
          initialData: [
            { id: 1, groupId: 1, createdBy: `alice` },
            { id: 2, groupId: 1, createdBy: `bob` },
          ],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<GroupChild>({
          id: `shared-corr-children`,
          getKey: (c) => c.id,
          initialData: [{ id: 10, groupId: 1, createdBy: `alice` }],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          createdBy: p.createdBy,
          items: q
            .from({ c: children })
            .where(({ c }) => eq(c.groupId, p.groupId))
            .where(({ c }) => eq(c.createdBy, p.createdBy))
            .select(({ c }) => ({
              id: c.id,
              createdBy: c.createdBy,
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          createdBy: `alice`,
          items: [{ id: 10, createdBy: `alice` }],
        },
        {
          id: 2,
          createdBy: `bob`,
          items: [],
        },
      ])
    })

    it(`shared correlation key with parent filter + orderBy + limit`, async () => {
      // Regression: grouped ordering for limit must use the composite routing
      // key, not the raw correlation key. Otherwise two parents that share the
      // same correlation key but differ on the parent-referenced filter get
      // their children merged before the limit is applied.
      type GroupParent = {
        id: number
        groupId: number
        createdBy: string
      }

      type GroupChild = {
        id: number
        groupId: number
        createdBy: string
      }

      const parents = createCollection(
        mockSyncCollectionOptions<GroupParent>({
          id: `limit-corr-parents`,
          getKey: (p) => p.id,
          initialData: [
            { id: 1, groupId: 1, createdBy: `alice` },
            { id: 2, groupId: 1, createdBy: `bob` },
          ],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<GroupChild>({
          id: `limit-corr-children`,
          getKey: (c) => c.id,
          initialData: [
            { id: 10, groupId: 1, createdBy: `alice` },
            { id: 11, groupId: 1, createdBy: `bob` },
          ],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          createdBy: p.createdBy,
          items: q
            .from({ c: children })
            .where(({ c }) => eq(c.groupId, p.groupId))
            .where(({ c }) => eq(c.createdBy, p.createdBy))
            .orderBy(({ c }) => c.id, `asc`)
            .limit(1)
            .select(({ c }) => ({
              id: c.id,
              createdBy: c.createdBy,
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          createdBy: `alice`,
          items: [{ id: 10, createdBy: `alice` }],
        },
        {
          id: 2,
          createdBy: `bob`,
          items: [{ id: 11, createdBy: `bob` }],
        },
      ])
    })

    it(`extracts correlation from and() with more than 2 args`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projectsWC }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          createdBy: p.createdBy,
          issues: q
            .from({ i: issuesWC })
            .where(({ i }) =>
              and(
                eq(i.projectId, p.id),
                eq(i.createdBy, p.createdBy),
                eq(i.title, `Bug in Alpha`),
              ),
            )
            .select(({ i }) => ({
              id: i.id,
              title: i.title,
              createdBy: i.createdBy,
            })),
        })),
      )

      await collection.preload()

      // Only project 1 (alice) has an issue matching all three conditions
      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha`, createdBy: `alice` },
      ])
      expect(childItems((collection.get(2) as any).issues)).toEqual([])
      expect(childItems((collection.get(3) as any).issues)).toEqual([])
    })

    it(`nested includes with parent-referencing filters at both levels`, async () => {
      // Regression: nested routing index must use composite routing keys
      // (matching the nested buffer keys) so that grandchild changes are
      // routed correctly when parent-referencing filters exist at both levels.
      type NProject = { id: number; groupId: number; createdBy: string }
      type NIssue = {
        id: number
        groupId: number
        createdBy: string
        categoryId: number
      }
      type NComment = {
        id: number
        categoryId: number
        createdBy: string
        body: string
      }

      const nProjects = createCollection(
        mockSyncCollectionOptions<NProject>({
          id: `nested-pref-projects`,
          getKey: (p) => p.id,
          initialData: [{ id: 1, groupId: 1, createdBy: `alice` }],
        }),
      )

      const nIssues = createCollection(
        mockSyncCollectionOptions<NIssue>({
          id: `nested-pref-issues`,
          getKey: (i) => i.id,
          initialData: [
            { id: 10, groupId: 1, createdBy: `alice`, categoryId: 7 },
          ],
        }),
      )

      const nComments = createCollection(
        mockSyncCollectionOptions<NComment>({
          id: `nested-pref-comments`,
          getKey: (c) => c.id,
          initialData: [
            { id: 100, categoryId: 7, createdBy: `alice`, body: `a` },
          ],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: nProjects }).select(({ p }) => ({
          id: p.id,
          issues: q
            .from({ i: nIssues })
            .where(({ i }) => eq(i.groupId, p.groupId))
            .where(({ i }) => eq(i.createdBy, p.createdBy))
            .select(({ i }) => ({
              id: i.id,
              createdBy: i.createdBy,
              categoryId: i.categoryId,
              comments: q
                .from({ c: nComments })
                .where(({ c }) => eq(c.categoryId, i.categoryId))
                .where(({ c }) => eq(c.createdBy, i.createdBy))
                .select(({ c }) => ({
                  id: c.id,
                  createdBy: c.createdBy,
                  body: c.body,
                })),
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          issues: [
            {
              id: 10,
              createdBy: `alice`,
              categoryId: 7,
              comments: [{ id: 100, createdBy: `alice`, body: `a` }],
            },
          ],
        },
      ])
    })

    it(`three levels of nested includes with parent-referencing filters`, async () => {
      // Verifies that composite routing keys work at arbitrary nesting depth,
      // not just the first two levels.
      type L0 = { id: number; groupId: number; owner: string }
      type L1 = {
        id: number
        groupId: number
        owner: string
        tagId: number
      }
      type L2 = {
        id: number
        tagId: number
        owner: string
        flagId: number
      }
      type L3 = { id: number; flagId: number; owner: string; text: string }

      const l0 = createCollection(
        mockSyncCollectionOptions<L0>({
          id: `deep-l0`,
          getKey: (r) => r.id,
          initialData: [{ id: 1, groupId: 1, owner: `alice` }],
        }),
      )
      const l1 = createCollection(
        mockSyncCollectionOptions<L1>({
          id: `deep-l1`,
          getKey: (r) => r.id,
          initialData: [{ id: 10, groupId: 1, owner: `alice`, tagId: 5 }],
        }),
      )
      const l2 = createCollection(
        mockSyncCollectionOptions<L2>({
          id: `deep-l2`,
          getKey: (r) => r.id,
          initialData: [{ id: 100, tagId: 5, owner: `alice`, flagId: 9 }],
        }),
      )
      const l3 = createCollection(
        mockSyncCollectionOptions<L3>({
          id: `deep-l3`,
          getKey: (r) => r.id,
          initialData: [{ id: 1000, flagId: 9, owner: `alice`, text: `deep` }],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ a: l0 }).select(({ a }) => ({
          id: a.id,
          children: q
            .from({ b: l1 })
            .where(({ b }) => eq(b.groupId, a.groupId))
            .where(({ b }) => eq(b.owner, a.owner))
            .select(({ b }) => ({
              id: b.id,
              tagId: b.tagId,
              owner: b.owner,
              grandchildren: q
                .from({ c: l2 })
                .where(({ c }) => eq(c.tagId, b.tagId))
                .where(({ c }) => eq(c.owner, b.owner))
                .select(({ c }) => ({
                  id: c.id,
                  flagId: c.flagId,
                  owner: c.owner,
                  leaves: q
                    .from({ d: l3 })
                    .where(({ d }) => eq(d.flagId, c.flagId))
                    .where(({ d }) => eq(d.owner, c.owner))
                    .select(({ d }) => ({
                      id: d.id,
                      text: d.text,
                    })),
                })),
            })),
        })),
      )

      await collection.preload()

      expect(toTree(collection)).toEqual([
        {
          id: 1,
          children: [
            {
              id: 10,
              tagId: 5,
              owner: `alice`,
              grandchildren: [
                {
                  id: 100,
                  flagId: 9,
                  owner: `alice`,
                  leaves: [{ id: 1000, text: `deep` }],
                },
              ],
            },
          ],
        },
      ])
    })
  })
})
