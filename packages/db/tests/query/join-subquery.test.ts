import { beforeEach, describe, expect, test } from "vitest"
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
    projectId: 2,
    userId: 2,
    duration: 15,
    createdAt: `2024-01-05`,
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
  {
    id: 3,
    name: `Charlie`,
    status: `inactive`,
    email: `charlie@example.com`,
    departmentId: 2,
  },
  {
    id: 4,
    name: `Dave`,
    status: `active`,
    email: `dave@example.com`,
    departmentId: undefined,
  },
]

function createIssuesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `join-subquery-test-issues`,
      getKey: (issue) => issue.id,
      initialData: sampleIssues,
      autoIndex,
    })
  )
}

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `join-subquery-test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    })
  )
}

function createJoinSubqueryTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    describe(`subqueries in FROM clause with joins`, () => {
      let issuesCollection: ReturnType<typeof createIssuesCollection>
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        issuesCollection = createIssuesCollection(autoIndex)
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`should join subquery with collection - inner join`, () => {
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

        const results = joinQuery.toArray
        expect(results).toHaveLength(3) // Issues 1, 2, 3 from project 1 with users

        const resultTitles = results.map((r) => r.issue_title).sort()
        expect(resultTitles).toEqual([`Bug 1`, `Bug 2`, `Feature 1`])

        const alice = results.find((r) => r.user_name === `Alice`)
        expect(alice).toMatchObject({
          user_name: `Alice`,
          user_status: `active`,
        })
      })

      test(`should join collection with subquery - left join`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            // Subquery: filter active users
            const activeUsers = q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.status, `active`))

            // Join all issues with active users subquery
            return q
              .from({ issue: issuesCollection })
              .join(
                { activeUser: activeUsers },
                ({ issue, activeUser }) => eq(issue.userId, activeUser.id),
                `left`
              )
              .select(({ issue, activeUser }) => ({
                issue_title: issue.title,
                user_name: activeUser.name,
                issue_status: issue.status,
              }))
          },
        })

        const results = joinQuery.toArray
        expect(results).toHaveLength(5) // All issues

        // Issues with active users should have user_name
        const activeUserIssues = results.filter(
          (r) => r.user_name !== undefined
        )
        expect(activeUserIssues).toHaveLength(4) // Issues 1, 2, 3, 5 have active users

        // Issue 4 has inactive user (Charlie), so should have undefined user_name
        const issue4 = results.find((r) => r.issue_title === `Bug 3`)
        expect(issue4).toMatchObject({
          issue_title: `Bug 3`,
          user_name: undefined,
          issue_status: `open`,
        })
      })

      test(`should join subquery with subquery - inner join`, () => {
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

        const results = joinQuery.toArray
        // Issues with duration > 7 AND active users: Issue 2 (Bob, 8), Issue 3 (Alice, 12), Issue 5 (Bob, 15)
        expect(results).toHaveLength(3)

        const resultData = results
          .map((r) => ({
            title: r.issue_title,
            duration: r.issue_duration,
            user: r.user_name,
          }))
          .sort((a, b) => a.duration - b.duration)

        expect(resultData).toEqual([
          { title: `Bug 2`, duration: 8, user: `Bob` },
          { title: `Feature 1`, duration: 12, user: `Alice` },
          { title: `Feature 2`, duration: 15, user: `Bob` },
        ])
      })
    })

    describe(`subqueries in JOIN clause`, () => {
      let issuesCollection: ReturnType<typeof createIssuesCollection>
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        issuesCollection = createIssuesCollection(autoIndex)
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`should use subquery in JOIN clause - inner join`, () => {
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

        const results = joinQuery.toArray
        // Alice and Bob are in engineering (dept 1), so issues 1, 2, 3, 5
        expect(results).toHaveLength(4)

        const userNames = results.map((r) => r.user_name).sort()
        expect(userNames).toEqual([`Alice`, `Alice`, `Bob`, `Bob`])

        // Issue 4 (Charlie from dept 2) should not appear
        const charlieIssue = results.find((r) => r.user_name === `Charlie`)
        expect(charlieIssue).toBeUndefined()
      })

      test(`should use subquery in JOIN clause - left join`, () => {
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
              .select(({ issue, activeUser }) => ({
                issue_title: issue.title,
                issue_status: issue.status,
                user_name: activeUser.name,
                user_status: activeUser.status,
              }))
          },
        })

        const results = joinQuery.toArray
        expect(results).toHaveLength(5) // All issues

        // Issues with active users should have user data
        const activeUserIssues = results.filter(
          (r) => r.user_name !== undefined
        )
        expect(activeUserIssues).toHaveLength(4) // Issues 1, 2, 3, 5

        // Issue 4 (Charlie is inactive) should have null user data
        const inactiveUserIssue = results.find((r) => r.issue_title === `Bug 3`)
        expect(inactiveUserIssue).toMatchObject({
          issue_title: `Bug 3`,
          issue_status: `open`,
          user_name: undefined,
          user_status: undefined,
        })
      })

      test(`should handle subqueries with SELECT clauses in both FROM and JOIN`, () => {
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

        const results = joinQuery.toArray
        expect(results).toHaveLength(3) // Issues 1, 2, 3 from project 1 with active users

        // Verify the transformed structure
        results.forEach((result) => {
          expect(result).toHaveProperty(`id`)
          expect(result).toHaveProperty(`name`)
          expect(result).toHaveProperty(`effort_hours`)
          expect(result).toHaveProperty(`is_high_priority`)
          expect(result).toHaveProperty(`assigned_to`)
          expect(result).toHaveProperty(`contact_email`)
          expect(result).toHaveProperty(`department`)
          expect(typeof result.is_high_priority).toBe(`boolean`)
        })

        const sortedResults = results.sort((a, b) => a.id - b.id)
        expect(sortedResults).toEqual([
          {
            id: 1,
            name: `Bug 1`,
            effort_hours: 5,
            is_high_priority: false,
            assigned_to: `Alice`,
            contact_email: `alice@example.com`,
            department: 1,
          },
          {
            id: 2,
            name: `Bug 2`,
            effort_hours: 8,
            is_high_priority: false,
            assigned_to: `Bob`,
            contact_email: `bob@example.com`,
            department: 1,
          },
          {
            id: 3,
            name: `Feature 1`,
            effort_hours: 12,
            is_high_priority: true,
            assigned_to: `Alice`,
            contact_email: `alice@example.com`,
            department: 1,
          },
        ])
      })
    })
  })
}

describe(`Join with Subqueries`, () => {
  createJoinSubqueryTests(`off`)
  createJoinSubqueryTests(`eager`)
})
