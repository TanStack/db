import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  and,
  coalesce,
  concat,
  count,
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { CleanupQueue } from '../../src/collection/cleanup-queue.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import type { SyncConfig } from '../../src/types.js'

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
  return sortedPlainRows(collection, sortKey)
}

function stripVirtualPropsDeep(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => stripVirtualPropsDeep(item))
  }

  if (value && typeof value === `object`) {
    if (`toArray` in value) {
      return toTree(value)
    }

    const base = stripVirtualProps(value)
    const out: Record<string, any> = {}
    for (const [key, entry] of Object.entries(base || {})) {
      out[key] = stripVirtualPropsDeep(entry)
    }
    return out
  }

  return value
}

function plainRows(collectionOrArray: any): Array<any> {
  const rows = Array.isArray(collectionOrArray)
    ? [...collectionOrArray]
    : [...collectionOrArray.toArray]
  return rows.map((row: any) => stripVirtualPropsDeep(row))
}

function sortedPlainRows(collectionOrArray: any, sortKey = `id`): Array<any> {
  return plainRows(collectionOrArray).sort(
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
  return rows.map((row: any) => stripVirtualPropsDeep(row))
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

  describe(`scalar includes materialization`, () => {
    type Message = {
      id: number
      role: string
    }

    type Chunk = {
      id: number
      messageId: number
      text: string
      timestamp: number
    }

    const sampleMessages: Array<Message> = [
      { id: 1, role: `assistant` },
      { id: 2, role: `user` },
    ]

    const sampleChunks: Array<Chunk> = [
      { id: 10, messageId: 1, text: `world`, timestamp: 3 },
      { id: 11, messageId: 1, text: `Hello`, timestamp: 1 },
      { id: 12, messageId: 1, text: ` `, timestamp: 2 },
      { id: 20, messageId: 2, text: `Question`, timestamp: 1 },
    ]

    function createMessagesCollection() {
      return createCollection(
        mockSyncCollectionOptions<Message>({
          id: `includes-messages`,
          getKey: (message) => message.id,
          initialData: sampleMessages,
        }),
      )
    }

    function createChunksCollection() {
      return createCollection(
        mockSyncCollectionOptions<Chunk>({
          id: `includes-chunks`,
          getKey: (chunk) => chunk.id,
          initialData: sampleChunks,
        }),
      )
    }

    it(`toArray unwraps scalar child selects into scalar arrays`, async () => {
      const messages = createMessagesCollection()
      const chunks = createChunksCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ m: messages }).select(({ m }) => ({
          id: m.id,
          contentParts: toArray(
            q
              .from({ c: chunks })
              .where(({ c }) => eq(c.messageId, m.id))
              .orderBy(({ c }) => c.timestamp)
              .select(({ c }) => c.text),
          ),
        })),
      )

      await collection.preload()

      expect((collection.get(1) as any).contentParts).toEqual([
        `Hello`,
        ` `,
        `world`,
      ])
      expect((collection.get(2) as any).contentParts).toEqual([`Question`])
    })

    it(`concat(toArray(subquery.select(...))) materializes and re-emits a string`, async () => {
      const messages = createMessagesCollection()
      const chunks = createChunksCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ m: messages }).select(({ m }) => ({
          id: m.id,
          role: m.role,
          content: concat(
            toArray(
              q
                .from({ c: chunks })
                .where(({ c }) => eq(c.messageId, m.id))
                .orderBy(({ c }) => c.timestamp)
                .select(({ c }) => c.text),
            ),
          ),
        })),
      )

      await collection.preload()

      expect((collection.get(1) as any).content).toBe(`Hello world`)
      expect((collection.get(2) as any).content).toBe(`Question`)

      const changeCallback = vi.fn()
      const subscription = collection.subscribeChanges(changeCallback, {
        includeInitialState: false,
      })
      changeCallback.mockClear()

      chunks.utils.begin()
      chunks.utils.write({
        type: `insert`,
        value: { id: 13, messageId: 1, text: `!`, timestamp: 4 },
      })
      chunks.utils.commit()

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(changeCallback).toHaveBeenCalled()
      expect((collection.get(1) as any).content).toBe(`Hello world!`)
      expect((collection.get(2) as any).content).toBe(`Question`)

      subscription.unsubscribe()
    })

    it(`top-level scalar select throws at root consumers`, () => {
      const messages = createMessagesCollection()

      expect(() =>
        (createLiveQueryCollection as any)((q: any) =>
          q.from({ m: messages }).select(({ m }: any) => m.role),
        ),
      ).toThrow(
        `Top-level scalar select() is not supported by createLiveQueryCollection() or queryOnce().`,
      )
    })
  })

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

    it(`updating a child reflects the change in the parent's child collection`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      // Update an existing child's title
      issues.utils.begin()
      issues.utils.write({
        type: `update`,
        value: { id: 10, projectId: 1, title: `Bug in Alpha (fixed)` },
      })
      issues.utils.commit()

      expect(childItems((collection.get(1) as any).issues)).toEqual([
        { id: 10, title: `Bug in Alpha (fixed)` },
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])

      subscription.unsubscribe()
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
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
      const alphaIssues = plainRows(alpha.issues)
      expect(alphaIssues).toEqual([
        { id: 11, title: `Feature for Alpha` },
        { id: 10, title: `Bug in Alpha` },
      ])

      // Beta has one issue, order doesn't matter but it should still work
      const beta = collection.get(2) as any
      const betaIssues = plainRows(beta.issues)
      expect(betaIssues).toEqual([{ id: 20, title: `Bug in Beta` }])

      // Gamma has no issues
      const gamma = collection.get(3) as any
      expect(plainRows(gamma.issues)).toEqual([])
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
      expect(plainRows((collection.get(1) as any).issues)).toEqual([
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
      expect(plainRows((collection.get(1) as any).issues)).toEqual([
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
      expect(plainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
      ])

      // Beta has 1 issue; limit(1) keeps it
      const beta = collection.get(2) as any
      expect(plainRows(beta.issues)).toEqual([{ id: 20, title: `Bug in Beta` }])

      // Gamma has 0 issues; limit(1) still empty
      const gamma = collection.get(3) as any
      expect(plainRows(gamma.issues)).toEqual([])
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
      const alphaIssues = plainRows((collection.get(1) as any).issues)
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
      expect(plainRows((collection.get(1) as any).issues)).toEqual([
        { id: 12, title: `Alpha priority issue` },
      ])

      // Beta should still have its 1 issue (limit is per-parent)
      expect(plainRows((collection.get(2) as any).issues)).toEqual([
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(Array.isArray(beta.issues)).toBe(true)
      expect(plainRows(beta.issues)).toEqual([{ id: 20, title: `Bug in Beta` }])
    })

    it(`empty parents get empty arrays`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      const gamma = collection.get(3) as any
      expect(Array.isArray(gamma.issues)).toBe(true)
      expect(plainRows(gamma.issues)).toEqual([])
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
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
      expect(plainRows(alpha.issues)).toEqual([
        { id: 11, title: `Feature for Alpha` },
      ])
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
      expect(plainRows(alpha.issues)).toEqual([
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
      expect(plainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(plainRows(beta.issues)).toEqual([{ id: 20, title: `Bug in Beta` }])

      const gamma = collection.get(3) as any
      expect(plainRows(gamma.issues)).toEqual([])
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
      expect(sortedPlainRows(issue10.comments)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      const issue11 = alpha.issues.get(11)
      expect(Array.isArray(issue11.comments)).toBe(true)
      expect(plainRows(issue11.comments)).toEqual([])
    })

    it(`adding a comment (grandchild-only change) updates the issue's comments array`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      const issue11Before = (collection.get(1) as any).issues.get(11)
      expect(plainRows(issue11Before.comments)).toEqual([])

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      const issue11After = (collection.get(1) as any).issues.get(11)
      expect(Array.isArray(issue11After.comments)).toBe(true)
      expect(plainRows(issue11After.comments)).toEqual([
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
      expect(plainRows(issue10After.comments)).toEqual([
        { id: 101, body: `Fixed it` },
      ])
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

      const sortedIssues = sortedPlainRows(alpha.issues)
      expect(Array.isArray(sortedIssues[0].comments)).toBe(true)
      expect(sortedPlainRows(sortedIssues[0].comments)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      expect(plainRows(sortedIssues[1].comments)).toEqual([])
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
      expect(plainRows(issue11.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
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
      expect(plainRows(issue10.comments)).toEqual([
        { id: 101, body: `Fixed it` },
      ])
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
      expect(plainRows(gamma.issues[0].comments)).toEqual([])

      // Alpha's issue 11 should have the new comment
      const alpha = collection.get(1) as any
      const issue11 = alpha.issues.find((i: any) => i.id === 11)
      expect(plainRows(issue11.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
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

  describe(`validation errors`, () => {
    it(`throws when child query has no WHERE clause`, () => {
      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ p: projects }).select(({ p }) => ({
            id: p.id,
            issues: q
              .from({ i: issues })
              .select(({ i }) => ({ id: i.id, title: i.title })),
          })),
        ),
      ).toThrow(/must have a WHERE clause with an eq\(\) condition/)
    })

    it(`throws when child WHERE has no eq() correlation`, () => {
      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ p: projects }).select(({ p }) => ({
            id: p.id,
            issues: q
              .from({ i: issues })
              .where(({ i }) => i.projectId)
              .select(({ i }) => ({ id: i.id, title: i.title })),
          })),
        ),
      ).toThrow(/must have a WHERE clause with an eq\(\) condition/)
    })

    it(`throws when eq() references two child-side aliases`, () => {
      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ p: projects }).select(({ p }) => ({
            id: p.id,
            issues: q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, i.id))
              .select(({ i }) => ({ id: i.id, title: i.title })),
          })),
        ),
      ).toThrow(/must have a WHERE clause with an eq\(\) condition/)
    })
  })

  describe(`multiple sibling includes`, () => {
    type Milestone = {
      id: number
      projectId: number
      name: string
    }

    const sampleMilestones: Array<Milestone> = [
      { id: 1, projectId: 1, name: `v1.0` },
      { id: 2, projectId: 1, name: `v2.0` },
      { id: 3, projectId: 2, name: `Beta release` },
    ]

    function createMilestonesCollection() {
      return createCollection(
        mockSyncCollectionOptions<Milestone>({
          id: `includes-milestones`,
          getKey: (m) => m.id,
          initialData: sampleMilestones,
        }),
      )
    }

    it(`parent with two sibling includes produces independent child collections`, async () => {
      const milestones = createMilestonesCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({ id: i.id, title: i.title })),
          milestones: q
            .from({ m: milestones })
            .where(({ m }) => eq(m.projectId, p.id))
            .select(({ m }) => ({ id: m.id, name: m.name })),
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
          milestones: [
            { id: 1, name: `v1.0` },
            { id: 2, name: `v2.0` },
          ],
        },
        {
          id: 2,
          name: `Beta`,
          issues: [{ id: 20, title: `Bug in Beta` }],
          milestones: [{ id: 3, name: `Beta release` }],
        },
        {
          id: 3,
          name: `Gamma`,
          issues: [],
          milestones: [],
        },
      ])
    })

    it(`adding a child to one sibling does not affect the other`, async () => {
      const milestones = createMilestonesCollection()

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: q
            .from({ i: issues })
            .where(({ i }) => eq(i.projectId, p.id))
            .select(({ i }) => ({ id: i.id, title: i.title })),
          milestones: q
            .from({ m: milestones })
            .where(({ m }) => eq(m.projectId, p.id))
            .select(({ m }) => ({ id: m.id, name: m.name })),
        })),
      )

      await collection.preload()

      // Add an issue to Alpha — milestones should be unaffected
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 12, projectId: 1, title: `New Alpha issue` },
      })
      issues.utils.commit()

      const alpha = collection.get(1) as any
      expect(childItems(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
        { id: 12, title: `New Alpha issue` },
      ])
      expect(childItems(alpha.milestones)).toEqual([
        { id: 1, name: `v1.0` },
        { id: 2, name: `v2.0` },
      ])

      // Add a milestone to Beta — issues should be unaffected
      milestones.utils.begin()
      milestones.utils.write({
        type: `insert`,
        value: { id: 4, projectId: 2, name: `Beta v2` },
      })
      milestones.utils.commit()

      const beta = collection.get(2) as any
      expect(childItems(beta.issues)).toEqual([
        { id: 20, title: `Bug in Beta` },
      ])
      expect(childItems(beta.milestones)).toEqual([
        { id: 3, name: `Beta release` },
        { id: 4, name: `Beta v2` },
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(Array.isArray(beta.issues)).toBe(true)
      expect(plainRows(beta.issues)).toEqual([{ id: 20, title: `Bug in Beta` }])
    })

    it(`empty parents get empty arrays`, async () => {
      const collection = buildToArrayQuery()
      await collection.preload()

      const gamma = collection.get(3) as any
      expect(Array.isArray(gamma.issues)).toBe(true)
      expect(plainRows(gamma.issues)).toEqual([])
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
      expect(sortedPlainRows(alpha.issues)).toEqual([
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
      expect(plainRows(alpha.issues)).toEqual([
        { id: 11, title: `Feature for Alpha` },
      ])
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
      expect(plainRows(alpha.issues)).toEqual([
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
      expect(plainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(plainRows(beta.issues)).toEqual([{ id: 20, title: `Bug in Beta` }])

      const gamma = collection.get(3) as any
      expect(plainRows(gamma.issues)).toEqual([])
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
      expect(sortedPlainRows(issue10.comments)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      const issue11 = alpha.issues.get(11)
      expect(Array.isArray(issue11.comments)).toBe(true)
      expect(plainRows(issue11.comments)).toEqual([])
    })

    it(`adding a comment (grandchild-only change) updates the issue's comments array`, async () => {
      const collection = buildCollectionToArrayQuery()
      await collection.preload()

      const issue11Before = (collection.get(1) as any).issues.get(11)
      expect(plainRows(issue11Before.comments)).toEqual([])

      comments.utils.begin()
      comments.utils.write({
        type: `insert`,
        value: { id: 110, issueId: 11, body: `Great feature` },
      })
      comments.utils.commit()

      const issue11After = (collection.get(1) as any).issues.get(11)
      expect(Array.isArray(issue11After.comments)).toBe(true)
      expect(plainRows(issue11After.comments)).toEqual([
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
      expect(plainRows(issue10After.comments)).toEqual([
        { id: 101, body: `Fixed it` },
      ])
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

      const sortedIssues = sortedPlainRows(alpha.issues)
      expect(Array.isArray(sortedIssues[0].comments)).toBe(true)
      expect(sortedPlainRows(sortedIssues[0].comments)).toEqual([
        { id: 100, body: `Looks bad` },
        { id: 101, body: `Fixed it` },
      ])

      expect(plainRows(sortedIssues[1].comments)).toEqual([])
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
      expect(plainRows(issue11.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
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
      expect(plainRows(issue10.comments)).toEqual([
        { id: 101, body: `Fixed it` },
      ])
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
      expect(plainRows(gamma.issues[0].comments)).toEqual([])

      // Alpha's issue 11 should have the new comment
      const alpha = collection.get(1) as any
      const issue11 = alpha.issues.find((i: any) => i.id === 11)
      expect(plainRows(issue11.comments)).toEqual([
        { id: 110, body: `Great feature` },
      ])
    })
  })

  // Aggregates in child queries: the aggregate (e.g. count) should be computed
  // per-parent, not globally across all parents. Currently, the correlation key
  // is lost after GROUP BY, causing all child rows to aggregate into a single
  // global result rather than per-parent results.
  describe(`aggregates in child queries`, () => {
    describe(`single-group aggregate: count issues per project (as Collection)`, () => {
      function buildAggregateQuery() {
        return createLiveQueryCollection((q) =>
          q.from({ p: projects }).select(({ p }) => ({
            id: p.id,
            name: p.name,
            issueCount: q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .select(({ i }) => ({ total: count(i.id) })),
          })),
        )
      }

      it(`each project gets its own aggregate result`, async () => {
        const collection = buildAggregateQuery()
        await collection.preload()

        // Alpha has 2 issues
        const alpha = collection.get(1) as any
        expect(childItems(alpha.issueCount, `total`)).toEqual([{ total: 2 }])

        // Beta has 1 issue
        const beta = collection.get(2) as any
        expect(childItems(beta.issueCount, `total`)).toEqual([{ total: 1 }])

        // Gamma has 0 issues — no matching rows means empty Collection
        const gamma = collection.get(3) as any
        expect(childItems(gamma.issueCount, `total`)).toEqual([])
      })

      it(`adding an issue updates the count for that parent`, async () => {
        const collection = buildAggregateQuery()
        await collection.preload()

        // Gamma starts with 0 issues
        expect(
          childItems((collection.get(3) as any).issueCount, `total`),
        ).toEqual([])

        issues.utils.begin()
        issues.utils.write({
          type: `insert`,
          value: { id: 30, projectId: 3, title: `Gamma issue` },
        })
        issues.utils.commit()

        // Gamma now has 1 issue
        expect(
          childItems((collection.get(3) as any).issueCount, `total`),
        ).toEqual([{ total: 1 }])

        // Alpha should still have 2
        expect(
          childItems((collection.get(1) as any).issueCount, `total`),
        ).toEqual([{ total: 2 }])
      })

      it(`removing an issue updates the count for that parent`, async () => {
        const collection = buildAggregateQuery()
        await collection.preload()

        // Alpha starts with 2 issues
        expect(
          childItems((collection.get(1) as any).issueCount, `total`),
        ).toEqual([{ total: 2 }])

        issues.utils.begin()
        issues.utils.write({
          type: `delete`,
          value: sampleIssues.find((i) => i.id === 10)!,
        })
        issues.utils.commit()

        // Alpha now has 1 issue
        expect(
          childItems((collection.get(1) as any).issueCount, `total`),
        ).toEqual([{ total: 1 }])

        // Beta should still have 1
        expect(
          childItems((collection.get(2) as any).issueCount, `total`),
        ).toEqual([{ total: 1 }])
      })
    })

    describe(`single-group aggregate: count issues per project (as toArray)`, () => {
      function buildAggregateToArrayQuery() {
        return createLiveQueryCollection((q) =>
          q.from({ p: projects }).select(({ p }) => ({
            id: p.id,
            name: p.name,
            issueCount: toArray(
              q
                .from({ i: issues })
                .where(({ i }) => eq(i.projectId, p.id))
                .select(({ i }) => ({ total: count(i.id) })),
            ),
          })),
        )
      }

      it(`each project gets its own aggregate result as an array`, async () => {
        const collection = buildAggregateToArrayQuery()
        await collection.preload()

        // Alpha has 2 issues
        const alpha = collection.get(1) as any
        expect(plainRows(alpha.issueCount)).toEqual([{ total: 2 }])

        // Beta has 1 issue
        const beta = collection.get(2) as any
        expect(plainRows(beta.issueCount)).toEqual([{ total: 1 }])

        // Gamma has 0 issues — empty array
        const gamma = collection.get(3) as any
        expect(plainRows(gamma.issueCount)).toEqual([])
      })
    })

    describe(`nested aggregate: count comments per issue (as Collection)`, () => {
      function buildNestedAggregateQuery() {
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
                commentCount: q
                  .from({ c: comments })
                  .where(({ c }) => eq(c.issueId, i.id))
                  .select(({ c }) => ({ total: count(c.id) })),
              })),
          })),
        )
      }

      it(`each issue gets its own comment count`, async () => {
        const collection = buildNestedAggregateQuery()
        await collection.preload()

        // Alpha's issues
        const alpha = collection.get(1) as any
        const issue10 = alpha.issues.get(10)
        expect(childItems(issue10.commentCount, `total`)).toEqual([
          { total: 2 },
        ])

        const issue11 = alpha.issues.get(11)
        // Issue 11 has 0 comments — empty Collection
        expect(childItems(issue11.commentCount, `total`)).toEqual([])

        // Beta's issue
        const beta = collection.get(2) as any
        const issue20 = beta.issues.get(20)
        expect(childItems(issue20.commentCount, `total`)).toEqual([
          { total: 1 },
        ])
      })
    })

    describe(`nested aggregate: count comments per issue (as toArray)`, () => {
      function buildNestedAggregateToArrayQuery() {
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
                commentCount: toArray(
                  q
                    .from({ c: comments })
                    .where(({ c }) => eq(c.issueId, i.id))
                    .select(({ c }) => ({ total: count(c.id) })),
                ),
              })),
          })),
        )
      }

      it(`each issue gets its own comment count as an array`, async () => {
        const collection = buildNestedAggregateToArrayQuery()
        await collection.preload()

        // Alpha's issues
        const alpha = collection.get(1) as any
        const issue10 = alpha.issues.get(10)
        expect(plainRows(issue10.commentCount)).toEqual([{ total: 2 }])

        const issue11 = alpha.issues.get(11)
        // Issue 11 has 0 comments — empty array
        expect(plainRows(issue11.commentCount)).toEqual([])

        // Beta's issue
        const beta = collection.get(2) as any
        const issue20 = beta.issues.get(20)
        expect(plainRows(issue20.commentCount)).toEqual([{ total: 1 }])
      })
    })
  })

  describe(`child collection garbage collection`, () => {
    beforeEach(() => {
      vi.useFakeTimers()
      CleanupQueue.resetInstance()
    })

    afterEach(() => {
      vi.useRealTimers()
      CleanupQueue.resetInstance()
    })

    it(`child collections should not be garbage collected when external subscribers unmount`, async () => {
      const collection = buildIncludesQuery()
      await collection.preload()

      // Verify child data exists
      const alpha = collection.get(1) as any
      expect(childItems(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      const beta = collection.get(2) as any
      expect(childItems(beta.issues)).toEqual([
        { id: 20, title: `Bug in Beta` },
      ])

      // Simulate what useLiveQuery does in React: subscribe to child collection,
      // then unsubscribe when the component unmounts (e.g., virtual table scroll)
      const childSub = alpha.issues.subscribeChanges(() => {})
      childSub.unsubscribe()

      // Advance well past the default gcTime (5 minutes = 300,000ms)
      await vi.advanceTimersByTimeAsync(600_000)

      // Child collection data should still be intact — the includes system
      // owns these collections and manages their lifecycle via flushIncludesState.
      // External GC must not destroy them.
      expect(childItems(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])
      expect(childItems(beta.issues)).toEqual([
        { id: 20, title: `Bug in Beta` },
      ])
    })
  })

  describe(`toArray/concat(toArray) inside expressions throws`, () => {
    it(`throws a clear error when concat(toArray()) is wrapped in coalesce()`, () => {
      type Message = { id: number; role: string }
      type Chunk = {
        id: number
        messageId: number
        text: string
        timestamp: number
      }

      const messages = createCollection(
        mockSyncCollectionOptions<Message>({
          id: `bug1-messages`,
          getKey: (m) => m.id,
          initialData: [{ id: 1, role: `assistant` }],
        }),
      )

      const chunks = createCollection(
        mockSyncCollectionOptions<Chunk>({
          id: `bug1-chunks`,
          getKey: (c) => c.id,
          initialData: [{ id: 10, messageId: 1, text: `Hello`, timestamp: 1 }],
        }),
      )

      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ m: messages }).select(({ m }) => ({
            id: m.id,
            content: coalesce(
              concat(
                toArray(
                  q
                    .from({ c: chunks })
                    .where(({ c }) => eq(c.messageId, m.id))
                    .orderBy(({ c }) => c.timestamp)
                    .select(({ c }) => c.text),
                ),
              ) as any,
              ``,
            ),
          })),
        ),
      ).toThrow(`concat(toArray()) cannot be used inside expressions`)
    })

    it(`toArray() wrapped in coalesce() also throws`, () => {
      type Parent = { id: number }
      type Child = { id: number; parentId: number }

      const parents = createCollection(
        mockSyncCollectionOptions<Parent>({
          id: `bug1b-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1 }],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<Child>({
          id: `bug1b-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      expect(() =>
        createLiveQueryCollection((q) =>
          q.from({ p: parents }).select(({ p }) => ({
            id: p.id,
            items: coalesce(
              toArray(
                q
                  .from({ c: children })
                  .where(({ c }) => eq(c.parentId, p.id))
                  .select(({ c }) => ({ id: c.id })),
              ) as any,
              [],
            ),
          })),
        ),
      ).toThrow(`toArray() cannot be used inside expressions`)
    })
  })

  describe(`sequential inserts into toArray child`, () => {
    it(`second insert propagates (mockSync)`, async () => {
      type Parent = { id: number; name: string }
      type Child = { id: number; parentId: number; title: string }

      const parents = createCollection(
        mockSyncCollectionOptions<Parent>({
          id: `bug2a-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1, name: `Alpha` }],
        }),
      )

      const children = createCollection(
        mockSyncCollectionOptions<Child>({
          id: `bug2a-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          items: toArray(
            q
              .from({ c: children })
              .where(({ c }) => eq(c.parentId, p.id))
              .select(({ c }) => ({
                id: c.id,
                title: c.title,
              })),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).items).toEqual([])

      // First insert
      children.utils.begin()
      children.utils.write({
        type: `insert`,
        value: { id: 10, parentId: 1, title: `First` },
      })
      children.utils.commit()
      expect((collection.get(1) as any).items).toHaveLength(1)

      // Second insert
      children.utils.begin()
      children.utils.write({
        type: `insert`,
        value: { id: 11, parentId: 1, title: `Second` },
      })
      children.utils.commit()
      expect((collection.get(1) as any).items).toHaveLength(2)
    })

    it(`second insert propagates (localOnly + collection.insert)`, async () => {
      type Parent = { id: number; name: string }
      type Child = { id: number; parentId: number; title: string }

      const parents = createCollection(
        localOnlyCollectionOptions<Parent>({
          id: `bug2b-parents`,
          getKey: (p) => p.id,
          initialData: [{ id: 1, name: `Alpha` }],
        }),
      )

      const children = createCollection(
        localOnlyCollectionOptions<Child>({
          id: `bug2b-children`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ p: parents }).select(({ p }) => ({
          id: p.id,
          items: toArray(
            q
              .from({ c: children })
              .where(({ c }) => eq(c.parentId, p.id))
              .select(({ c }) => ({
                id: c.id,
                title: c.title,
              })),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).items).toEqual([])

      // First insert via collection.insert()
      children.insert({ id: 10, parentId: 1, title: `First` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).items).toHaveLength(1)

      // Second insert via collection.insert()
      children.insert({ id: 11, parentId: 1, title: `Second` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).items).toHaveLength(2)
    })

    it(`second insert propagates via concat(toArray)`, async () => {
      type Message = { id: number; role: string }
      type Chunk = {
        id: number
        messageId: number
        text: string
        timestamp: number
      }

      const messages = createCollection(
        localOnlyCollectionOptions<Message>({
          id: `bug2c-messages`,
          getKey: (m) => m.id,
          initialData: [{ id: 1, role: `assistant` }],
        }),
      )

      const chunks = createCollection(
        localOnlyCollectionOptions<Chunk>({
          id: `bug2c-chunks`,
          getKey: (c) => c.id,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ m: messages }).select(({ m }) => ({
          id: m.id,
          content: concat(
            toArray(
              q
                .from({ c: chunks })
                .where(({ c }) => eq(c.messageId, m.id))
                .orderBy(({ c }) => c.timestamp)
                .select(({ c }) => c.text),
            ),
          ),
        })),
      )

      await collection.preload()
      expect((collection.get(1) as any).content).toBe(``)

      // First insert
      chunks.insert({
        id: 10,
        messageId: 1,
        text: `Hello`,
        timestamp: 1,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).content).toBe(`Hello`)

      // Second insert
      chunks.insert({
        id: 11,
        messageId: 1,
        text: ` world`,
        timestamp: 2,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(1) as any).content).toBe(`Hello world`)
    })

    it(`second insert propagates through chained live query collections (darix pattern)`, async () => {
      type RawDelta = {
        key: string
        text_id: string
        delta: string
        _seq: number
      }
      type Seed = { key: string }

      const TIMELINE_KEY = `timeline-1`

      const rawDeltas = createCollection(
        localOnlyCollectionOptions<RawDelta>({
          id: `chained-raw-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      const derivedDeltas = createLiveQueryCollection({
        id: `chained-derived-deltas`,
        query: (q: any) =>
          q.from({ d: rawDeltas }).select(({ d }: any) => ({
            key: d.key,
            text_id: d.text_id,
            timelineKey: TIMELINE_KEY,
            order: d._seq,
            delta: d.delta,
          })),
      })

      const seeds = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `chained-seeds`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      const collection = createLiveQueryCollection({
        query: (q: any) =>
          q.from({ s: seeds }).select(({ s }: any) => ({
            key: s.key,
            deltas: toArray(
              q
                .from({ d: derivedDeltas })
                .where(({ d }: any) => eq(d.timelineKey, s.key))
                .orderBy(({ d }: any) => d.order)
                .select(({ d }: any) => ({
                  key: d.key,
                  delta: d.delta,
                })),
            ),
          })),
      })

      await collection.preload()
      const data = () => collection.get(TIMELINE_KEY)

      expect(data().deltas).toEqual([])

      rawDeltas.insert({ key: `td-1`, text_id: `t-1`, delta: `Hello`, _seq: 1 })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().deltas).toHaveLength(1)
      expect(data().deltas[0].delta).toBe(`Hello`)

      rawDeltas.insert({
        key: `td-2`,
        text_id: `t-1`,
        delta: ` world`,
        _seq: 2,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().deltas).toHaveLength(2)
    })

    it(`second insert propagates with multiple sibling toArray includes`, async () => {
      type Seed = { key: string }
      type Text = { key: string; seedKey: string; status: string }
      type TextDelta = {
        key: string
        textId: string
        seedKey: string
        delta: string
        seq: number
      }

      const seeds = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `bug2d-seeds`,
          getKey: (s) => s.key,
          initialData: [{ key: `seed-1` }],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `bug2d-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `bug2d-textDeltas`,
          getKey: (td) => td.key,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection((q) =>
        q.from({ s: seeds }).select(({ s }) => ({
          key: s.key,
          texts: toArray(
            q
              .from({ t: texts })
              .where(({ t }) => eq(t.seedKey, s.key))
              .select(({ t }) => ({
                key: t.key,
                status: t.status,
              })),
          ),
          textDeltas: toArray(
            q
              .from({ td: textDeltas })
              .where(({ td }) => eq(td.seedKey, s.key))
              .orderBy(({ td }) => td.seq)
              .select(({ td }) => ({
                key: td.key,
                textId: td.textId,
                delta: td.delta,
              })),
          ),
        })),
      )

      await collection.preload()

      const data = () => collection.get(`seed-1`) as any

      texts.insert({ key: `text-1`, seedKey: `seed-1`, status: `streaming` })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().texts).toHaveLength(1)

      textDeltas.insert({
        key: `td-1`,
        textId: `text-1`,
        seedKey: `seed-1`,
        delta: `Hello`,
        seq: 1,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().textDeltas).toHaveLength(1)
      expect(data().textDeltas[0].delta).toBe(`Hello`)

      textDeltas.insert({
        key: `td-2`,
        textId: `text-1`,
        seedKey: `seed-1`,
        delta: ` world`,
        seq: 2,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(data().textDeltas).toHaveLength(2)
    })
  })

  describe(`nested toArray includes (depth 3+)`, () => {
    it(`control: flat concat(toArray) propagates delta inserts`, async () => {
      type Text = { key: string; _seq: number; status: string }
      type TextDelta = {
        key: string
        text_id: string
        _seq: number
        delta: string
      }

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `nested-ctrl-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `nested-ctrl-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      const collection = createLiveQueryCollection({
        id: `nested-ctrl-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            key: text.key,
            order: coalesce(text._seq, -1),
            status: text.status,
            text: concat(
              toArray(
                q
                  .from({ delta: textDeltas })
                  .where(({ delta }) => eq(delta.text_id, text.key))
                  .orderBy(({ delta }) => delta._seq)
                  .select(({ delta }) => delta.delta),
              ),
            ),
          })),
      })

      await collection.preload()

      texts.insert({ key: `text-1`, _seq: 1, status: `streaming` })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(``)

      textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        _seq: 2,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(`Hello`)

      textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        _seq: 3,
        delta: ` world`,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect((collection.get(`text-1`) as any)?.text).toBe(`Hello world`)
    })

    it(`nested toArray(runs) -> toArray(texts) -> concat(toArray(textDeltas)) propagates`, async () => {
      const TIMELINE_KEY = `tl-nested`

      type Seed = { key: string }
      type Run = { key: string; _seq: number; status: string }
      type Text = {
        key: string
        run_id: string
        _seq: number
        status: string
      }
      type TextDelta = {
        key: string
        text_id: string
        run_id: string
        _seq: number
        delta: string
      }

      const seed = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `nested-seed`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      const runs = createCollection(
        localOnlyCollectionOptions<Run>({
          id: `nested-runs`,
          getKey: (r) => r.key,
          initialData: [],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `nested-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `nested-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      const runsLive = createLiveQueryCollection({
        id: `nested-runs-live`,
        query: (q) =>
          q.from({ run: runs }).select(({ run }) => ({
            timelineKey: TIMELINE_KEY,
            key: run.key,
            order: coalesce(run._seq, -1),
            status: run.status,
          })),
      })

      const textsLive = createLiveQueryCollection({
        id: `nested-texts-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            timelineKey: TIMELINE_KEY,
            key: text.key,
            run_id: text.run_id,
            order: coalesce(text._seq, -1),
            status: text.status,
          })),
      })

      const textDeltasLive = createLiveQueryCollection({
        id: `nested-deltas-live`,
        query: (q) =>
          q.from({ delta: textDeltas }).select(({ delta }) => ({
            timelineKey: TIMELINE_KEY,
            key: delta.key,
            text_id: delta.text_id,
            run_id: delta.run_id,
            order: coalesce(delta._seq, -1),
            delta: delta.delta,
          })),
      })

      const timeline = createLiveQueryCollection({
        id: `nested-timeline`,
        query: (q) =>
          q.from({ s: seed }).select(({ s }) => ({
            key: s.key,
            runs: toArray(
              q
                .from({ run: runsLive })
                .where(({ run }) => eq(run.timelineKey, s.key))
                .orderBy(({ run }) => run.order)
                .select(({ run }) => ({
                  key: run.key,
                  order: run.order,
                  status: run.status,
                  texts: toArray(
                    q
                      .from({ text: textsLive })
                      .where(({ text }) => eq(text.run_id, run.key))
                      .orderBy(({ text }) => text.order)
                      .select(({ text }) => ({
                        key: text.key,
                        run_id: text.run_id,
                        order: text.order,
                        status: text.status,
                        text: concat(
                          toArray(
                            q
                              .from({ delta: textDeltasLive })
                              .where(({ delta }) => eq(delta.text_id, text.key))
                              .orderBy(({ delta }) => delta.order)
                              .select(({ delta }) => delta.delta),
                          ),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      })

      await timeline.preload()

      const data = () => timeline.get(TIMELINE_KEY) as any

      runs.insert({ key: `run-1`, _seq: 1, status: `started` })
      texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        _seq: 2,
        status: `streaming`,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs).toHaveLength(1)
      expect(data().runs[0].texts).toHaveLength(1)
      expect(data().runs[0].texts[0].text).toBe(``)

      textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        run_id: `run-1`,
        _seq: 3,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().runs[0].texts[0].text).toBe(`Hello`)

      textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        run_id: `run-1`,
        _seq: 4,
        delta: ` world`,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().runs[0].texts[0].text).toBe(`Hello world`)
    })

    it(`deep buffer change for one parent does not emit spurious update for sibling parent`, async () => {
      const TIMELINE_KEY = `tl-spurious`

      type Seed = { key: string }
      type Run = { key: string; _seq: number; status: string }
      type Text = {
        key: string
        run_id: string
        _seq: number
        status: string
      }
      type TextDelta = {
        key: string
        text_id: string
        run_id: string
        _seq: number
        delta: string
      }

      const seed = createCollection(
        localOnlyCollectionOptions<Seed>({
          id: `spurious-seed`,
          getKey: (s) => s.key,
          initialData: [{ key: TIMELINE_KEY }],
        }),
      )

      const runs = createCollection(
        localOnlyCollectionOptions<Run>({
          id: `spurious-runs`,
          getKey: (r) => r.key,
          initialData: [],
        }),
      )

      const texts = createCollection(
        localOnlyCollectionOptions<Text>({
          id: `spurious-texts`,
          getKey: (t) => t.key,
          initialData: [],
        }),
      )

      const textDeltas = createCollection(
        localOnlyCollectionOptions<TextDelta>({
          id: `spurious-deltas`,
          getKey: (d) => d.key,
          initialData: [],
        }),
      )

      const runsLive = createLiveQueryCollection({
        id: `spurious-runs-live`,
        query: (q) =>
          q.from({ run: runs }).select(({ run }) => ({
            timelineKey: TIMELINE_KEY,
            key: run.key,
            order: coalesce(run._seq, -1),
            status: run.status,
          })),
      })

      const textsLive = createLiveQueryCollection({
        id: `spurious-texts-live`,
        query: (q) =>
          q.from({ text: texts }).select(({ text }) => ({
            timelineKey: TIMELINE_KEY,
            key: text.key,
            run_id: text.run_id,
            order: coalesce(text._seq, -1),
            status: text.status,
          })),
      })

      const textDeltasLive = createLiveQueryCollection({
        id: `spurious-deltas-live`,
        query: (q) =>
          q.from({ delta: textDeltas }).select(({ delta }) => ({
            timelineKey: TIMELINE_KEY,
            key: delta.key,
            text_id: delta.text_id,
            run_id: delta.run_id,
            order: coalesce(delta._seq, -1),
            delta: delta.delta,
          })),
      })

      const timeline = createLiveQueryCollection({
        id: `spurious-timeline`,
        query: (q) =>
          q.from({ s: seed }).select(({ s }) => ({
            key: s.key,
            runs: toArray(
              q
                .from({ run: runsLive })
                .where(({ run }) => eq(run.timelineKey, s.key))
                .orderBy(({ run }) => run.order)
                .select(({ run }) => ({
                  key: run.key,
                  order: run.order,
                  status: run.status,
                  texts: toArray(
                    q
                      .from({ text: textsLive })
                      .where(({ text }) => eq(text.run_id, run.key))
                      .orderBy(({ text }) => text.order)
                      .select(({ text }) => ({
                        key: text.key,
                        run_id: text.run_id,
                        order: text.order,
                        status: text.status,
                        text: concat(
                          toArray(
                            q
                              .from({ delta: textDeltasLive })
                              .where(({ delta }) => eq(delta.text_id, text.key))
                              .orderBy(({ delta }) => delta.order)
                              .select(({ delta }) => delta.delta),
                          ),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      })

      await timeline.preload()

      const data = () => timeline.get(TIMELINE_KEY) as any

      runs.insert({ key: `run-1`, _seq: 1, status: `started` })
      runs.insert({ key: `run-2`, _seq: 2, status: `started` })
      texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        _seq: 3,
        status: `streaming`,
      })
      texts.insert({
        key: `text-2`,
        run_id: `run-2`,
        _seq: 4,
        status: `streaming`,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs).toHaveLength(2)
      expect(data().runs[0].texts[0].text).toBe(``)
      expect(data().runs[1].texts[0].text).toBe(``)

      const timelineRowBefore = data()
      const run1TextsBefore = timelineRowBefore.runs[0].texts
      const updateEvents: Array<any> = []
      timeline.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `update`) {
            updateEvents.push(change)
          }
        }
      })

      textDeltas.insert({
        key: `td-1`,
        text_id: `text-2`,
        run_id: `run-2`,
        _seq: 5,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs[1].texts[0].text).toBe(`Hello`)
      expect(data().runs[0].texts[0].text).toBe(``)

      expect(data().runs[0].texts).toBe(run1TextsBefore)
    })
  })

  describe(`many sibling toArray includes with chained derived collections`, () => {
    function createSyncCollection<T extends object>(
      id: string,
      getKey: (item: T) => string | number,
    ) {
      let syncBegin: () => void
      let syncWrite: (msg: { type: string; value: T }) => void
      let syncCommit: () => void

      const collection = createCollection<T>({
        id,
        getKey,
        sync: {
          sync: (params: any) => {
            syncBegin = params.begin
            syncWrite = params.write
            syncCommit = params.commit
            params.markReady()
            return () => {}
          },
        } as SyncConfig<T>,
        startSync: true,
        gcTime: 0,
      })

      return {
        collection,
        insert(value: T) {
          syncBegin!()
          syncWrite!({ type: `insert`, value })
          syncCommit!()
        },
      }
    }

    const TIMELINE_KEY = `timeline`

    type RawItem = { key: string; _seq: number; [k: string]: unknown }

    function createDerivedCollection(
      id: string,
      source: ReturnType<typeof createSyncCollection<any>>[`collection`],
      extraFields?: (d: any) => Record<string, unknown>,
    ) {
      return createLiveQueryCollection({
        id: `${id}:derived`,
        query: (q: any) =>
          q.from({ d: source }).select(({ d }: any) => ({
            timelineKey: TIMELINE_KEY,
            key: d.key,
            order: coalesce(d._seq, -1),
            ...(extraFields ? extraFields(d) : {}),
          })),
      })
    }

    it(`second insert propagates with 5 sibling chained toArray includes`, async () => {
      const runs = createSyncCollection<RawItem>(`raw-runs`, (r) => r.key)
      const texts = createSyncCollection<RawItem>(`raw-texts`, (r) => r.key)
      const textDeltas = createSyncCollection<RawItem>(
        `raw-textDeltas`,
        (r) => r.key,
      )
      const toolCalls = createSyncCollection<RawItem>(
        `raw-toolCalls`,
        (r) => r.key,
      )
      const steps = createSyncCollection<RawItem>(`raw-steps`, (r) => r.key)

      const derivedRuns = createDerivedCollection(
        `runs`,
        runs.collection,
        (d) => ({
          status: d.status,
        }),
      )
      const derivedTexts = createDerivedCollection(
        `texts`,
        texts.collection,
        (d) => ({
          run_id: d.run_id,
          status: d.status,
        }),
      )
      const derivedTextDeltas = createDerivedCollection(
        `textDeltas`,
        textDeltas.collection,
        (d) => ({
          text_id: d.text_id,
          run_id: d.run_id,
          delta: d.delta,
        }),
      )
      const derivedToolCalls = createDerivedCollection(
        `toolCalls`,
        toolCalls.collection,
        (d) => ({
          run_id: d.run_id,
          tool_name: d.tool_name,
        }),
      )
      const derivedSteps = createDerivedCollection(
        `steps`,
        steps.collection,
        (d) => ({
          run_id: d.run_id,
          step_number: d.step_number,
        }),
      )

      const seeds = createCollection({
        id: `seed`,
        getKey: (s: { key: string }) => s.key,
        sync: {
          sync: (params: any) => {
            params.begin()
            params.write({ type: `insert`, value: { key: TIMELINE_KEY } })
            params.commit()
            params.markReady()
            return () => {}
          },
        } as SyncConfig<{ key: string }>,
        startSync: true,
        gcTime: 0,
      })

      const collection = createLiveQueryCollection({
        query: (q: any) =>
          q.from({ s: seeds }).select(({ s }: any) => ({
            key: s.key,
            runs: toArray(
              q
                .from({ r: derivedRuns })
                .where(({ r }: any) => eq(r.timelineKey, s.key))
                .orderBy(({ r }: any) => r.order)
                .select(({ r }: any) => ({ key: r.key, status: r.status })),
            ),
            texts: toArray(
              q
                .from({ t: derivedTexts })
                .where(({ t }: any) => eq(t.timelineKey, s.key))
                .orderBy(({ t }: any) => t.order)
                .select(({ t }: any) => ({
                  key: t.key,
                  run_id: t.run_id,
                  status: t.status,
                })),
            ),
            textDeltas: toArray(
              q
                .from({ td: derivedTextDeltas })
                .where(({ td }: any) => eq(td.timelineKey, s.key))
                .orderBy(({ td }: any) => td.order)
                .select(({ td }: any) => ({
                  key: td.key,
                  text_id: td.text_id,
                  delta: td.delta,
                })),
            ),
            toolCalls: toArray(
              q
                .from({ tc: derivedToolCalls })
                .where(({ tc }: any) => eq(tc.timelineKey, s.key))
                .orderBy(({ tc }: any) => tc.order)
                .select(({ tc }: any) => ({
                  key: tc.key,
                  tool_name: tc.tool_name,
                })),
            ),
            steps: toArray(
              q
                .from({ st: derivedSteps })
                .where(({ st }: any) => eq(st.timelineKey, s.key))
                .orderBy(({ st }: any) => st.order)
                .select(({ st }: any) => ({
                  key: st.key,
                  step_number: st.step_number,
                })),
            ),
          })),
      })

      await collection.preload()

      const data = () => collection.get(TIMELINE_KEY)

      runs.insert({ key: `run-1`, status: `started`, _seq: 1 })
      texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        status: `streaming`,
        _seq: 2,
      })
      await new Promise((r) => setTimeout(r, 100))

      expect(data().runs).toHaveLength(1)
      expect(data().texts).toHaveLength(1)
      expect(data().textDeltas).toHaveLength(0)

      textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        run_id: `run-1`,
        delta: `Hello`,
        _seq: 3,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().textDeltas).toHaveLength(1)
      expect(data().textDeltas[0].delta).toBe(`Hello`)

      textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        run_id: `run-1`,
        delta: ` world`,
        _seq: 4,
      })
      await new Promise((r) => setTimeout(r, 100))
      expect(data().textDeltas).toHaveLength(2)
    })
  })

  describe(`materialize`, () => {
    // For singleton behavior we look up each issue's parent project.
    // Each issue references exactly one project via projectId.
    function buildSingletonQuery() {
      return createLiveQueryCollection((q) =>
        q.from({ i: issues }).select(({ i }) => ({
          id: i.id,
          title: i.title,
          project: materialize(
            q
              .from({ p: projects })
              .where(({ p }) => eq(p.id, i.projectId))
              .select(({ p }) => ({
                id: p.id,
                name: p.name,
              }))
              .findOne(),
          ),
        })),
      )
    }

    it(`findOne() materializes a single value, not an array`, async () => {
      const collection = buildSingletonQuery()
      await collection.preload()

      const bug = collection.get(10) as any
      expect(Array.isArray(bug.project)).toBe(false)
      expect(stripVirtualPropsDeep(bug.project)).toEqual({
        id: 1,
        name: `Alpha`,
      })

      const betaBug = collection.get(20) as any
      expect(stripVirtualPropsDeep(betaBug.project)).toEqual({
        id: 2,
        name: `Beta`,
      })
    })

    it(`findOne() with no matching child yields undefined`, async () => {
      // Issue referencing a non-existent project
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 99, projectId: 999, title: `Orphan issue` },
      })
      issues.utils.commit()

      const collection = buildSingletonQuery()
      await collection.preload()

      const orphan = collection.get(99) as any
      expect(orphan.project).toBeUndefined()
    })

    it(`inserting the matching child re-emits parent with populated singleton`, async () => {
      // Start with an issue whose project doesn't exist yet
      issues.utils.begin()
      issues.utils.write({
        type: `insert`,
        value: { id: 99, projectId: 999, title: `Orphan issue` },
      })
      issues.utils.commit()

      const collection = buildSingletonQuery()
      await collection.preload()

      expect((collection.get(99) as any).project).toBeUndefined()

      // Now create the matching project
      projects.utils.begin()
      projects.utils.write({
        type: `insert`,
        value: { id: 999, name: `Late Project` },
      })
      projects.utils.commit()

      expect(
        stripVirtualPropsDeep((collection.get(99) as any).project),
      ).toEqual({ id: 999, name: `Late Project` })
    })

    it(`updating the matching child re-emits parent with updated singleton`, async () => {
      const collection = buildSingletonQuery()
      await collection.preload()

      projects.utils.begin()
      projects.utils.write({
        type: `update`,
        value: { id: 1, name: `Renamed Alpha` },
      })
      projects.utils.commit()

      const bug = collection.get(10) as any
      expect(stripVirtualPropsDeep(bug.project)).toEqual({
        id: 1,
        name: `Renamed Alpha`,
      })
    })

    it(`deleting the matching child re-emits parent with undefined`, async () => {
      const collection = buildSingletonQuery()
      await collection.preload()

      expect((collection.get(20) as any).project).toBeDefined()

      projects.utils.begin()
      projects.utils.write({
        type: `delete`,
        value: sampleProjects.find((p) => p.id === 2)!,
      })
      projects.utils.commit()

      expect((collection.get(20) as any).project).toBeUndefined()
    })

    it(`two parents sharing a correlation key both see the singleton`, async () => {
      const collection = buildSingletonQuery()
      await collection.preload()

      // Issues 10 and 11 both reference project 1
      const bug = collection.get(10) as any
      const feature = collection.get(11) as any
      expect(stripVirtualPropsDeep(bug.project)).toEqual({
        id: 1,
        name: `Alpha`,
      })
      expect(stripVirtualPropsDeep(feature.project)).toEqual({
        id: 1,
        name: `Alpha`,
      })

      // Updating the shared project re-emits both parents
      projects.utils.begin()
      projects.utils.write({
        type: `update`,
        value: { id: 1, name: `Alpha v2` },
      })
      projects.utils.commit()

      expect(
        stripVirtualPropsDeep((collection.get(10) as any).project),
      ).toEqual({ id: 1, name: `Alpha v2` })
      expect(
        stripVirtualPropsDeep((collection.get(11) as any).project),
      ).toEqual({ id: 1, name: `Alpha v2` })
    })

    it(`materialize over a multi-row subquery still returns Array<T>`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: materialize(
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

      const alpha = collection.get(1) as any
      expect(Array.isArray(alpha.issues)).toBe(true)
      expect(sortedPlainRows(alpha.issues)).toEqual([
        { id: 10, title: `Bug in Alpha` },
        { id: 11, title: `Feature for Alpha` },
      ])

      const gamma = collection.get(3) as any
      expect(Array.isArray(gamma.issues)).toBe(true)
      expect(plainRows(gamma.issues)).toEqual([])
    })

    it(`materialize over a scalar findOne() returns the scalar value`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ i: issues }).select(({ i }) => ({
          id: i.id,
          projectName: materialize(
            q
              .from({ p: projects })
              .where(({ p }) => eq(p.id, i.projectId))
              .select(({ p }) => p.name)
              .findOne(),
          ),
        })),
      )
      await collection.preload()

      expect((collection.get(10) as any).projectName).toBe(`Alpha`)
      expect((collection.get(20) as any).projectName).toBe(`Beta`)
    })

    it(`nested materialize: array of issues with singleton first-comment lookup each`, async () => {
      const collection = createLiveQueryCollection((q) =>
        q.from({ p: projects }).select(({ p }) => ({
          id: p.id,
          name: p.name,
          issues: materialize(
            q
              .from({ i: issues })
              .where(({ i }) => eq(i.projectId, p.id))
              .select(({ i }) => ({
                id: i.id,
                title: i.title,
                firstComment: materialize(
                  q
                    .from({ c: comments })
                    .where(({ c }) => eq(c.issueId, i.id))
                    .orderBy(({ c }) => c.id, `asc`)
                    .select(({ c }) => ({ id: c.id, body: c.body }))
                    .findOne(),
                ),
              })),
          ),
        })),
      )
      await collection.preload()

      const alpha = collection.get(1) as any
      const issuesArr = stripVirtualPropsDeep(alpha.issues).sort(
        (a: any, b: any) => a.id - b.id,
      )
      expect(issuesArr).toEqual([
        {
          id: 10,
          title: `Bug in Alpha`,
          firstComment: { id: 100, body: `Looks bad` },
        },
        {
          id: 11,
          title: `Feature for Alpha`,
          firstComment: undefined,
        },
      ])
    })
  })
})
