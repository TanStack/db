import { beforeEach, describe, expect, test } from "vitest"
import { createLiveQueryCollection, eq, gt } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample types for subquery testing
type Issue = {
  id: number
  title: string
  status: `open` | `in_progress` | `closed`
  projectId: number
  userId: number
  duration: number
  createdAt: string
}

// Sample data
const sampleIssues: Array<Issue> = [
  {
    id: 1,
    title: `Bug 1`,
    status: `open`,
    projectId: 1,
    userId: 1,
    duration: 5,
    createdAt: `2024-01-01`,
  },
  {
    id: 2,
    title: `Bug 2`,
    status: `in_progress`,
    projectId: 1,
    userId: 2,
    duration: 8,
    createdAt: `2024-01-02`,
  },
  {
    id: 3,
    title: `Feature 1`,
    status: `closed`,
    projectId: 1,
    userId: 1,
    duration: 12,
    createdAt: `2024-01-03`,
  },
  {
    id: 4,
    title: `Bug 3`,
    status: `open`,
    projectId: 2,
    userId: 3,
    duration: 3,
    createdAt: `2024-01-04`,
  },
  {
    id: 5,
    title: `Feature 2`,
    status: `in_progress`,
    projectId: 1,
    userId: 2,
    duration: 15,
    createdAt: `2024-01-05`,
  },
]

function createIssuesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `subquery-test-issues`,
      getKey: (issue) => issue.id,
      initialData: sampleIssues,
      autoIndex,
    })
  )
}

function createSubqueryTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    describe(`basic subqueries in FROM clause`, () => {
      let issuesCollection: ReturnType<typeof createIssuesCollection>

      beforeEach(() => {
        issuesCollection = createIssuesCollection(autoIndex)
      })

      test(`should create live query with simple subquery in FROM clause`, () => {
        const liveCollection = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const projectIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => eq(issue.projectId, 1))

            return q
              .from({ filteredIssue: projectIssues })
              .select(({ filteredIssue }) => ({
                id: filteredIssue.id,
                title: filteredIssue.title,
                status: filteredIssue.status,
              }))
          },
        })

        const results = liveCollection.toArray
        expect(results).toHaveLength(4) // Issues 1, 2, 3, 5 are from project 1

        expect(results.map((r) => r.id).sort()).toEqual([1, 2, 3, 5])
        expect(results.map((r) => r.title)).toEqual(
          expect.arrayContaining([`Bug 1`, `Bug 2`, `Feature 1`, `Feature 2`])
        )
      })

      test(`should create live query with subquery using query function syntax`, async () => {
        const liveCollection = createLiveQueryCollection((q) => {
          const openIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => eq(issue.status, `open`))

          return q.from({ openIssue: openIssues }).select(({ openIssue }) => ({
            id: openIssue.id,
            title: openIssue.title,
            projectId: openIssue.projectId,
          }))
        })
        await liveCollection.preload()

        const results = liveCollection.toArray
        expect(results).toHaveLength(2) // Issues 1 and 4 are open

        expect(results.map((r) => r.id).sort()).toEqual([1, 4])
        expect(
          results.every(
            (r) => sampleIssues.find((i) => i.id === r.id)?.status === `open`
          )
        ).toBe(true)
      })

      test(`should return original collection type when subquery has no select`, () => {
        const liveCollection = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const longIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => gt(issue.duration, 10))

            return q.from({ longIssue: longIssues })
          },
        })

        const results = liveCollection.toArray
        expect(results).toHaveLength(2) // Issues 3 and 5 have duration > 10

        // Should return the original Issue type with all properties
        results.forEach((result) => {
          expect(result).toHaveProperty(`id`)
          expect(result).toHaveProperty(`title`)
          expect(result).toHaveProperty(`status`)
          expect(result).toHaveProperty(`projectId`)
          expect(result).toHaveProperty(`userId`)
          expect(result).toHaveProperty(`duration`)
          expect(result).toHaveProperty(`createdAt`)
        })

        expect(results.map((r) => r.id).sort()).toEqual([3, 5])
        expect(results.every((r) => r.duration > 10)).toBe(true)
      })

      test(`should use custom getKey when provided with subqueries`, () => {
        const customKeyCollection = createLiveQueryCollection({
          id: `custom-key-subquery`,
          startSync: true,
          query: (q) => {
            const highDurationIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => gt(issue.duration, 5))

            return q
              .from({ issue: highDurationIssues })
              .select(({ issue }) => ({
                issueId: issue.id,
                issueTitle: issue.title,
                durationHours: issue.duration,
              }))
          },
          getKey: (item) => item.issueId,
        })

        const results = customKeyCollection.toArray
        expect(results).toHaveLength(3) // Issues with duration > 5: Issues 2, 3, 5

        // Verify we can get items by their custom key
        expect(customKeyCollection.get(2)).toMatchObject({
          issueId: 2,
          issueTitle: `Bug 2`,
          durationHours: 8,
        })
      })

      test(`should auto-generate unique IDs for subquery collections`, () => {
        const collection1 = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const openIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => eq(issue.status, `open`))

            return q.from({ issue: openIssues })
          },
        })

        const collection2 = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const closedIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => eq(issue.status, `closed`))

            return q.from({ issue: closedIssues })
          },
        })

        // Verify that auto-generated IDs are unique
        expect(collection1.id).toMatch(/^live-query-\d+$/)
        expect(collection2.id).toMatch(/^live-query-\d+$/)
        expect(collection1.id).not.toBe(collection2.id)

        // Verify collections work correctly
        expect(collection1.toArray).toHaveLength(2) // Open issues
        expect(collection2.toArray).toHaveLength(1) // Closed issues
      })

      test(`should handle subquery with SELECT clause transforming data`, () => {
        const liveCollection = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            // Subquery that transforms and selects specific fields
            const transformedIssues = q
              .from({ issue: issuesCollection })
              .where(({ issue }) => gt(issue.duration, 5))
              .select(({ issue }) => ({
                issueKey: issue.id,
                summary: issue.title,
                timeSpent: issue.duration,
                isHighPriority: gt(issue.duration, 10),
                category: issue.status,
              }))

            // Use the transformed subquery
            return q
              .from({ transformed: transformedIssues })
              .where(({ transformed }) => eq(transformed.isHighPriority, true))
              .select(({ transformed }) => ({
                key: transformed.issueKey,
                title: transformed.summary,
                hours: transformed.timeSpent,
                type: transformed.category,
              }))
          },
        })

        const results = liveCollection.toArray
        expect(results).toHaveLength(2) // Issues 3 and 5 have duration > 10

        // Verify the transformed structure
        results.forEach((result) => {
          expect(result).toHaveProperty(`key`)
          expect(result).toHaveProperty(`title`)
          expect(result).toHaveProperty(`hours`)
          expect(result).toHaveProperty(`type`)
          expect(result.hours).toBeGreaterThan(10)
        })

        const sortedResults = results.sort((a, b) => a.key - b.key)
        expect(sortedResults).toEqual([
          { key: 3, title: `Feature 1`, hours: 12, type: `closed` },
          { key: 5, title: `Feature 2`, hours: 15, type: `in_progress` },
        ])
      })
    })
  })
}

describe(`Subquery`, () => {
  createSubqueryTests(`off`)
  createSubqueryTests(`eager`)
})
