import { describe, expectTypeOf, test } from "vitest"
import { createLiveQueryCollection, eq, gt } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample data types for join-subquery testing
type Issue = {
  id: number
  title: string
  status: `open` | `in_progress` | `closed`
  projectId: number
  userId: number
  duration: number
  createdAt: string
}

type User = {
  id: number
  name: string
  status: `active` | `inactive`
  email: string
  departmentId: number | undefined
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
]

const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    status: `active`,
    email: `alice@example.com`,
    departmentId: 1,
  },
  {
    id: 2,
    name: `Bob`,
    status: `active`,
    email: `bob@example.com`,
    departmentId: 1,
  },
]

function createIssuesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `join-subquery-test-issues-types`,
      getKey: (issue) => issue.id,
      initialData: sampleIssues,
    })
  )
}

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `join-subquery-test-users-types`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    })
  )
}

describe(`Join Subquery Types`, () => {
  const issuesCollection = createIssuesCollection()
  const usersCollection = createUsersCollection()

  describe(`subqueries in FROM clause with joins`, () => {
    test(`join subquery with collection preserves correct types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery: filter issues by project 1
          const project1Issues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => eq(issue.projectId, 1))

          // Join subquery with users
          return q
            .from({ issue: project1Issues })
            .join(
              { user: usersCollection },
              ({ issue, user }) => eq(issue.userId, user.id),
              `inner`
            )
            .select(({ issue, user }) => ({
              issue_title: issue.title,
              user_name: user.name,
              issue_duration: issue.duration,
              user_status: user.status,
            }))
        },
      })

      // Should infer the correct joined result type
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue_title: string
          user_name: string
          issue_duration: number
          user_status: `active` | `inactive`
        }>
      >()
    })

    test(`left join collection with subquery without SELECT preserves namespaced types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery: filter active users
          const activeUsers = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.status, `active`))

          // Join all issues with active users subquery - no SELECT to test namespaced result
          return q
            .from({ issue: issuesCollection })
            .join(
              { activeUser: activeUsers },
              ({ issue, activeUser }) => eq(issue.userId, activeUser.id),
              `left`
            )
        },
      })

      // Left join should make the joined table optional in namespaced result
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue: Issue
          activeUser: User | undefined
        }>
      >()
    })

    test(`join subquery with subquery preserves correct types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // First subquery: high-duration issues
          const longIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => gt(issue.duration, 7))

          // Second subquery: active users
          const activeUsers = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.status, `active`))

          // Join both subqueries
          return q
            .from({ longIssue: longIssues })
            .join(
              { activeUser: activeUsers },
              ({ longIssue, activeUser }) =>
                eq(longIssue.userId, activeUser.id),
              `inner`
            )
            .select(({ longIssue, activeUser }) => ({
              issue_title: longIssue.title,
              issue_duration: longIssue.duration,
              user_name: activeUser.name,
              user_email: activeUser.email,
            }))
        },
      })

      // Should infer the correct result type from both subqueries
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue_title: string
          issue_duration: number
          user_name: string
          user_email: string
        }>
      >()
    })
  })

  describe(`subqueries in JOIN clause`, () => {
    test(`subquery in JOIN clause with inner join preserves types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery for engineering department users (departmentId: 1)
          const engineeringUsers = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.departmentId, 1))

          return q
            .from({ issue: issuesCollection })
            .join(
              { engUser: engineeringUsers },
              ({ issue, engUser }) => eq(issue.userId, engUser.id),
              `inner`
            )
            .select(({ issue, engUser }) => ({
              issue_title: issue.title,
              user_name: engUser.name,
              user_email: engUser.email,
            }))
        },
      })

      // Should infer the correct result type
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue_title: string
          user_name: string
          user_email: string
        }>
      >()
    })

    test(`subquery in JOIN clause with left join without SELECT preserves namespaced types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery for active users only
          const activeUsers = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.status, `active`))

          return q
            .from({ issue: issuesCollection })
            .join(
              { activeUser: activeUsers },
              ({ issue, activeUser }) => eq(issue.userId, activeUser.id),
              `left`
            )
        },
      })

      // Left join should make the joined subquery optional in namespaced result
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue: Issue
          activeUser: User | undefined
        }>
      >()
    })

    test(`complex subqueries with SELECT clauses preserve transformed types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery 1: Transform issues with SELECT
          const transformedIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => eq(issue.projectId, 1))
            .select(({ issue }) => ({
              taskId: issue.id,
              taskName: issue.title,
              effort: issue.duration,
              assigneeId: issue.userId,
              isHighPriority: gt(issue.duration, 8),
            }))

          // Subquery 2: Transform users with SELECT
          const userProfiles = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.status, `active`))
            .select(({ user }) => ({
              profileId: user.id,
              fullName: user.name,
              contact: user.email,
              team: user.departmentId,
            }))

          // Join both transformed subqueries
          return q
            .from({ task: transformedIssues })
            .join(
              { profile: userProfiles },
              ({ task, profile }) => eq(task.assigneeId, profile.profileId),
              `inner`
            )
            .select(({ task, profile }) => ({
              id: task.taskId,
              name: task.taskName,
              effort_hours: task.effort,
              is_high_priority: task.isHighPriority,
              assigned_to: profile.fullName,
              contact_email: profile.contact,
              department: profile.team,
            }))
        },
      })

      // Should infer the final transformed and joined type
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          id: number
          name: string
          effort_hours: number
          is_high_priority: boolean
          assigned_to: string
          contact_email: string
          department: number | undefined
        }>
      >()
    })
  })

  describe(`subqueries without SELECT in joins`, () => {
    test(`subquery without SELECT in FROM clause preserves original types`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery without SELECT - should preserve original Issue type
          const filteredIssues = q
            .from({ issue: issuesCollection })
            .where(({ issue }) => gt(issue.duration, 5))

          return q
            .from({ issue: filteredIssues })
            .join(
              { user: usersCollection },
              ({ issue, user }) => eq(issue.userId, user.id),
              `inner`
            )
            .select(({ issue, user }) => ({
              // Should have access to all original Issue properties
              issue_id: issue.id,
              issue_title: issue.title,
              issue_status: issue.status,
              issue_project_id: issue.projectId,
              issue_user_id: issue.userId,
              issue_duration: issue.duration,
              issue_created_at: issue.createdAt,
              user_name: user.name,
            }))
        },
      })

      // Should infer types with all original Issue properties available
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue_id: number
          issue_title: string
          issue_status: `open` | `in_progress` | `closed`
          issue_project_id: number
          issue_user_id: number
          issue_duration: number
          issue_created_at: string
          user_name: string
        }>
      >()
    })

    test(`left join with SELECT should make joined fields optional (FIXED)`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          // Subquery: filter active users
          const activeUsers = q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.status, `active`))

          // Join all issues with active users subquery with SELECT
          return q
            .from({ issue: issuesCollection })
            .join(
              { activeUser: activeUsers },
              ({ issue, activeUser }) => eq(issue.userId, activeUser.id),
              `left`
            )
            .select(({ issue, activeUser }) => ({
              issue_title: issue.title,
              user_name: activeUser.name, // Should now be string | undefined
              issue_status: issue.status,
            }))
        },
      })

      // With the new approach, this should now correctly infer string | undefined for user_name
      expectTypeOf(joinQuery.toArray).toEqualTypeOf<
        Array<{
          issue_title: string
          user_name: string | undefined
          issue_status: `open` | `in_progress` | `closed`
        }>
      >()
    })
  })
})
