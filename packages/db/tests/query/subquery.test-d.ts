import { describe, expectTypeOf, test } from "vitest"
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
]

function createIssuesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `subquery-test-issues-types`,
      getKey: (issue) => issue.id,
      initialData: sampleIssues,
    })
  )
}

describe(`Subquery Types`, () => {
  const issuesCollection = createIssuesCollection()

  describe(`basic subqueries in FROM clause`, () => {
    test(`subquery in FROM clause preserves correct types`, () => {
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

      // Should infer the correct result type from the SELECT clause
      expectTypeOf(liveCollection.toArray).toEqualTypeOf<
        Array<{
          id: number
          title: string
          status: `open` | `in_progress` | `closed`
        }>
      >()
    })

    test(`subquery without SELECT returns original collection type`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const longIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => gt(issue.duration, 10))

          return q.from({ longIssue: longIssues })
        },
      })

      // Should return the original Issue type
      expectTypeOf(liveCollection.toArray).toEqualTypeOf<Array<Issue>>()
    })

    test(`subquery with SELECT clause transforms type correctly`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
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

      // Should infer the final transformed type
      expectTypeOf(liveCollection.toArray).toEqualTypeOf<
        Array<{
          key: number
          title: string
          hours: number
          type: `open` | `in_progress` | `closed`
        }>
      >()
    })

    test(`nested subqueries preserve type information`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // First level subquery
          const filteredIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => eq(issue.projectId, 1))
            .select(({ issue }) => ({
              taskId: issue.id,
              taskTitle: issue.title,
              effort: issue.duration,
            }))

          // Second level subquery
          const highEffortTasks = q
            .from({ task: filteredIssues })
            .where(({ task }) => gt(task.effort, 5))

          return q
            .from({ finalTask: highEffortTasks })
            .select(({ finalTask }) => ({
              id: finalTask.taskId,
              name: finalTask.taskTitle,
              workHours: finalTask.effort,
            }))
        },
      })

      // Should infer the final nested transformation type
      expectTypeOf(liveCollection.toArray).toEqualTypeOf<
        Array<{
          id: number
          name: string
          workHours: number
        }>
      >()
    })

    test(`subquery with custom getKey preserves type`, () => {
      const customKeyCollection = createLiveQueryCollection({
        id: `custom-key-subquery-types`,
        query: (q) => {
          const highDurationIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => gt(issue.duration, 5))

          return q.from({ issue: highDurationIssues }).select(({ issue }) => ({
            issueId: issue.id,
            issueTitle: issue.title,
            durationHours: issue.duration,
          }))
        },
        getKey: (item) => item.issueId,
      })

      // Should infer the correct result type
      expectTypeOf(customKeyCollection.toArray).toEqualTypeOf<
        Array<{
          issueId: number
          issueTitle: string
          durationHours: number
        }>
      >()

      // getKey should work with the transformed type
      expectTypeOf(customKeyCollection.get(1)).toEqualTypeOf<
        | {
            issueId: number
            issueTitle: string
            durationHours: number
          }
        | undefined
      >()
    })

    test(`query function syntax with subqueries preserves types`, () => {
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

      // Should infer the correct result type
      expectTypeOf(liveCollection.toArray).toEqualTypeOf<
        Array<{
          id: number
          title: string
          projectId: number
        }>
      >()
    })
  })
})
