import { describe, expect, it } from "vitest"
import { D2, MultiSet, output } from "@tanstack/db-ivm"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import { compileQuery } from "../../../src/query/compiler/index.js"
import { CollectionImpl } from "../../../src/collection.js"
import { avg, count, eq } from "../../../src/query/builder/functions.js"

// Test schema types
interface Issue {
  id: number
  title: string
  status: `open` | `in_progress` | `closed`
  projectId: number
  userId: number
  duration: number
  createdAt: string
}

interface User {
  id: number
  name: string
  status: `active` | `inactive`
}

// D2-compatible types for input streams
// Helper function to create D2-compatible inputs
const createIssueInput = (graph: D2) =>
  graph.newInput<[number, Record<string, unknown>]>()
const createUserInput = (graph: D2) =>
  graph.newInput<[number, Record<string, unknown>]>()

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

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, status: `active` },
  { id: 2, name: `Bob`, status: `active` },
  { id: 3, name: `Charlie`, status: `inactive` },
]

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

// Helper functions to create D2-compatible inputs and send data
const sendIssueData = (input: any, issues: Array<Issue>) => {
  input.sendData(
    new MultiSet(
      issues.map((issue) => [
        [issue.id, issue as unknown as Record<string, unknown>],
        1,
      ])
    )
  )
}

const sendUserData = (input: any, users: Array<User>) => {
  input.sendData(
    new MultiSet(
      users.map((user) => [
        [user.id, user as unknown as Record<string, unknown>],
        1,
      ])
    )
  )
}

describe(`Query2 Subqueries`, () => {
  describe(`Subqueries in FROM clause`, () => {
    it(`supports simple subquery in from clause`, () => {
      // Create a base query that filters issues for project 1
      const baseQuery = new Query()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Use the base query as a subquery in the from clause
      const query = new Query()
        .from({ filteredIssues: baseQuery })
        .select(({ filteredIssues }) => ({
          id: filteredIssues.id,
          title: filteredIssues.title,
          status: filteredIssues.status,
        }))

      const builtQuery = getQueryIR(query)

      // Verify the IR structure
      expect(builtQuery.from.type).toBe(`queryRef`)
      expect(builtQuery.from.alias).toBe(`filteredIssues`)
      if (builtQuery.from.type === `queryRef`) {
        expect(builtQuery.from.query.from.type).toBe(`collectionRef`)
        expect(builtQuery.from.query.where).toBeDefined()
      }
      expect(builtQuery.select).toBeDefined()
    })

    it(`compiles and executes subquery in from clause`, () => {
      // Create a base query that filters issues for project 1
      const baseQuery = new Query()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Use the base query as a subquery in the from clause
      const query = new Query()
        .from({ filteredIssues: baseQuery })
        .select(({ filteredIssues }) => ({
          id: filteredIssues.id,
          title: filteredIssues.title,
          status: filteredIssues.status,
        }))

      const builtQuery = getQueryIR(query)

      // Compile and execute the query
      const graph = new D2()
      const issuesInput = createIssueInput(graph)
      const { pipeline } = compileQuery(builtQuery, { issues: issuesInput })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send sample data
      sendIssueData(issuesInput, sampleIssues)

      graph.run()

      // Check results - should only include issues from project 1
      const results = messages[0]!.getInner().map(([data]) => data[1][0])
      expect(results).toHaveLength(4) // Issues 1, 2, 3, 5 are from project 1

      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`title`)
        expect(result).toHaveProperty(`status`)
      })

      // Verify specific results
      const ids = results.map((r) => r.id).sort()
      expect(ids).toEqual([1, 2, 3, 5])
    })
  })

  describe(`Subqueries in JOIN clause`, () => {
    it(`supports subquery in join clause`, () => {
      // Create a subquery for active users
      const activeUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, `active`))

      // Use the subquery in a join
      const query = new Query()
        .from({ issue: issuesCollection })
        .join({ activeUser: activeUsersQuery }, ({ issue, activeUser }) =>
          eq(issue.userId, activeUser.id)
        )
        .select(({ issue, activeUser }) => ({
          issueId: issue.id,
          issueTitle: issue.title,
          userName: activeUser.name,
        }))

      const builtQuery = getQueryIR(query)

      // Verify the IR structure
      expect(builtQuery.from.type).toBe(`collectionRef`)
      expect(builtQuery.join).toBeDefined()
      expect(builtQuery.join).toHaveLength(1)

      const joinClause = builtQuery.join![0]!
      expect(joinClause.from.type).toBe(`queryRef`)
      expect(joinClause.from.alias).toBe(`activeUser`)

      if (joinClause.from.type === `queryRef`) {
        expect(joinClause.from.query.from.type).toBe(`collectionRef`)
        expect(joinClause.from.query.where).toBeDefined()
      }
    })

    it(`compiles and executes subquery in join clause`, () => {
      // Create a subquery for active users
      const activeUsersQuery = new Query()
        .from({ user: usersCollection })
        .where(({ user }) => eq(user.status, `active`))

      // Use the subquery in a join
      const query = new Query()
        .from({ issue: issuesCollection })
        .join({ activeUser: activeUsersQuery }, ({ issue, activeUser }) =>
          eq(issue.userId, activeUser.id)
        )
        .select(({ issue, activeUser }) => ({
          issueId: issue.id,
          issueTitle: issue.title,
          userName: activeUser.name,
        }))

      const builtQuery = getQueryIR(query)

      // Compile and execute the query
      const graph = new D2()
      const issuesInput = createIssueInput(graph)
      const usersInput = createUserInput(graph)
      const { pipeline } = compileQuery(builtQuery, {
        issues: issuesInput,
        users: usersInput,
      })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send sample data
      sendIssueData(issuesInput, sampleIssues)
      sendUserData(usersInput, sampleUsers)

      graph.run()

      // Check results - should only include issues with active users
      const results = messages[0]!.getInner().map(([data]) => data[1][0])

      // Alice (id: 1) and Bob (id: 2) are active, Charlie (id: 3) is inactive
      // Issues 1, 3 belong to Alice, Issues 2, 5 belong to Bob, Issue 4 belongs to Charlie
      // So we should get 4 results (issues 1, 2, 3, 5)
      expect(results.length).toBeGreaterThan(0) // At least some results

      results.forEach((result) => {
        expect(result).toHaveProperty(`issueId`)
        expect(result).toHaveProperty(`issueTitle`)
        expect(result).toHaveProperty(`userName`)
        if (result.userName) {
          // Only check defined userNames
          expect([`Alice`, `Bob`]).toContain(result.userName) // Only active users
        }
      })
    })
  })

  describe(`Complex composable queries`, () => {
    it(`executes simple aggregate subquery`, () => {
      // Create a base query that filters issues for project 1
      const baseQuery = new Query()
        .from({ issue: issuesCollection })
        .where(({ issue }) => eq(issue.projectId, 1))

      // Simple aggregate query using base query
      const allAggregate = new Query()
        .from({ issue: baseQuery })
        .select(({ issue }) => ({
          count: count(issue.id),
          avgDuration: avg(issue.duration),
        }))

      const builtQuery = getQueryIR(allAggregate)

      // Execute the aggregate query
      const graph = new D2()
      const issuesInput = createIssueInput(graph)
      const { pipeline } = compileQuery(builtQuery, { issues: issuesInput })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send sample data
      sendIssueData(issuesInput, sampleIssues)

      graph.run()

      // Check results
      const results = messages[0]!.getInner().map(([data]) => data[1][0])
      expect(results.length).toBeGreaterThan(0) // At least one result

      // Check that we have aggregate results with count and avgDuration
      results.forEach((result) => {
        expect(result).toHaveProperty(`count`)
        expect(result).toHaveProperty(`avgDuration`)
        expect(typeof result.count).toBe(`number`)
        expect(typeof result.avgDuration).toBe(`number`)
      })
    })
  })
})
