import { describe, expectTypeOf, test } from "vitest"
import { BaseQueryBuilder } from "../../../src/query2/builder/index.js"
import { CollectionImpl } from "../../../src/collection.js"
import { eq, count, avg } from "../../../src/query2/builder/functions.js"
import type { GetResult } from "../../../src/query2/builder/types.js"

// Test schema types
interface Issue {
  id: number
  title: string
  status: 'open' | 'in_progress' | 'closed'
  projectId: number
  userId: number
  duration: number
  createdAt: string
}

interface User {
  id: number
  name: string
  status: 'active' | 'inactive'
}

// Test collections
const issuesCollection = new CollectionImpl<Issue>({
  id: `issues`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

const usersCollection = new CollectionImpl<User>({
  id: `users`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe("Subquery Types", () => {
  describe("Subqueries in FROM clause", () => {
    test("BaseQueryBuilder preserves type information", () => {
      const baseQuery = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Check that the baseQuery has the correct result type
      expectTypeOf<GetResult<typeof baseQuery['__context']>>().toEqualTypeOf<Issue>()
    })

    test("subquery in from clause without any cast", () => {
      const baseQuery = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // This should work WITHOUT any cast
      new BaseQueryBuilder()
        .from({ filteredIssues: baseQuery })
        .select(({ filteredIssues }) => ({
          id: filteredIssues.id,
          title: filteredIssues.title,
          status: filteredIssues.status,
        }))

      // Verify the filteredIssues has the correct type (Issue)
      const selectCallback = ({ filteredIssues }: any) => {
        expectTypeOf(filteredIssues.id).toEqualTypeOf<any>() // RefProxy<number>
        expectTypeOf(filteredIssues.title).toEqualTypeOf<any>() // RefProxy<string>
        expectTypeOf(filteredIssues.status).toEqualTypeOf<any>() // RefProxy<'open' | 'in_progress' | 'closed'>
        expectTypeOf(filteredIssues.projectId).toEqualTypeOf<any>() // RefProxy<number>
        expectTypeOf(filteredIssues.userId).toEqualTypeOf<any>() // RefProxy<number>
        expectTypeOf(filteredIssues.duration).toEqualTypeOf<any>() // RefProxy<number>
        expectTypeOf(filteredIssues.createdAt).toEqualTypeOf<any>() // RefProxy<string>
        return {}
      }

      type SelectContext = Parameters<typeof selectCallback>[0]
      expectTypeOf<SelectContext['filteredIssues']>().toMatchTypeOf<Issue>()
    })

    test("subquery with select clause preserves selected type", () => {
      const baseQuery = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))
        .select(({ issue }) => ({
          id: issue.id,
          title: issue.title,
        }))

      // This should work WITHOUT any cast
      const query = new BaseQueryBuilder()
        .from({ filteredIssues: baseQuery })
        .select(({ filteredIssues }) => ({
          id: filteredIssues.id,
          title: filteredIssues.title,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        id: number
        title: string
      }>()
    })
  })

  describe("Subqueries in JOIN clause", () => {
    test("subquery in join clause without any cast", () => {
      const activeUsersQuery = new BaseQueryBuilder()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, "active"))

      // This should work WITHOUT any cast
      const query = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .join(
          { activeUser: activeUsersQuery },
          ({ issue, activeUser }) => eq(issue.userId, activeUser.id)
        )
        .select(({ issue, activeUser }) => ({
          issueId: issue.id,
          issueTitle: issue.title,
          userName: activeUser.name,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        issueId: number
        issueTitle: string
        userName: string
      }>()
    })

    test("subquery with select in join preserves selected type", () => {
      const userNamesQuery = new BaseQueryBuilder()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, "active"))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
        }))

      // This should work WITHOUT any cast
      const query = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .join(
          { activeUser: userNamesQuery },
          ({ issue, activeUser }) => eq(issue.userId, activeUser.id)
        )
        .select(({ issue, activeUser }) => ({
          issueId: issue.id,
          userName: activeUser.name,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        issueId: number
        userName: string
      }>()
    })
  })

  describe("Complex composable queries", () => {
    test("aggregate queries with subqueries", () => {
      const baseQuery = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Aggregate query using base query - NO CAST!
      const allAggregate = new BaseQueryBuilder()
        .from({ issue: baseQuery })
        .select(({ issue }) => ({
          count: count(issue.id),
          avgDuration: avg(issue.duration)
        }))

      // Verify the result type
      type AggregateResult = GetResult<typeof allAggregate['__context']>
      expectTypeOf<AggregateResult>().toEqualTypeOf<{
        count: number
        avgDuration: number
      }>()
    })

    test("group by queries with subqueries", () => {
      const baseQuery = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Group by query using base query - NO CAST!
      const byStatusAggregate = new BaseQueryBuilder()
        .from({ issue: baseQuery })
        .groupBy(({ issue }) => issue.status)
        .select(({ issue }) => ({
          status: issue.status,
          count: count(issue.id),
          avgDuration: avg(issue.duration)
        }))

      // Verify the result type
      type GroupedResult = GetResult<typeof byStatusAggregate['__context']>
      expectTypeOf<GroupedResult>().toEqualTypeOf<{
        status: 'open' | 'in_progress' | 'closed'
        count: number
        avgDuration: number
      }>()
    })
  })

  describe("Nested subqueries", () => {
    test("subquery of subquery", () => {
      // First level subquery
      const filteredIssues = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Second level subquery using first subquery
      const highDurationIssues = new BaseQueryBuilder()
        .from({ issue: filteredIssues })
        .where(({ issue }) => eq(issue.duration, 10))

      // Final query using nested subquery - NO CAST!
      const query = new BaseQueryBuilder()
        .from({ issue: highDurationIssues })
        .select(({ issue }) => ({
          id: issue.id,
          title: issue.title,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        id: number
        title: string
      }>()
    })
  })

  describe("Mixed collections and subqueries", () => {
    test("join collection with subquery", () => {
      const activeUsers = new BaseQueryBuilder()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, "active"))

      // Join regular collection with subquery - NO CAST!
      const query = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .join(
          { activeUser: activeUsers },
          ({ issue, activeUser }) => eq(issue.userId, activeUser.id)
        )
        .select(({ issue, activeUser }) => ({
          issueId: issue.id,
          userName: activeUser.name,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        issueId: number
        userName: string
      }>()
    })

    test("join subquery with collection", () => {
      const filteredIssues = new BaseQueryBuilder()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Join subquery with regular collection - NO CAST!
      const query = new BaseQueryBuilder()
        .from({ issue: filteredIssues })
        .join(
          { user: usersCollection },
          ({ issue, user }) => eq(issue.userId, user.id)
        )
        .select(({ issue, user }) => ({
          issueId: issue.id,
          userName: user.name,
        }))

      // Verify the result type
      type QueryResult = GetResult<typeof query['__context']>
      expectTypeOf<QueryResult>().toEqualTypeOf<{
        issueId: number
        userName: string
      }>()
    })
  })
}) 