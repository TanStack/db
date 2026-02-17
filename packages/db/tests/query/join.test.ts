import { beforeEach, describe, expect, test } from 'vitest'
import {
  concat,
  createLiveQueryCollection,
  eq,
  gt,
  isNull,
  isUndefined,
  lt,
  not,
  or,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

// Sample data types for join testing
type User = {
  id: number
  name: string
  email: string
  department_id: number | undefined
}

type Department = {
  id: number
  name: string
  budget: number
}

// Sample user data
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, email: `alice@example.com`, department_id: 1 },
  { id: 2, name: `Bob`, email: `bob@example.com`, department_id: 1 },
  { id: 3, name: `Charlie`, email: `charlie@example.com`, department_id: 2 },
  { id: 4, name: `Dave`, email: `dave@example.com`, department_id: undefined },
]

// Sample department data
const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering`, budget: 100000 },
  { id: 2, name: `Sales`, budget: 80000 },
  { id: 3, name: `Marketing`, budget: 60000 },
]

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    }),
  )
}

function createDepartmentsCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: sampleDepartments,
      autoIndex,
    }),
  )
}

// Join types to test
const joinTypes = [`inner`, `left`, `right`, `full`] as const
type JoinType = (typeof joinTypes)[number]

// Expected results for each join type
const expectedResults = {
  inner: {
    initialCount: 3, // Alice+Eng, Bob+Eng, Charlie+Sales
    userNames: [`Alice`, `Bob`, `Charlie`],
    includesDave: false,
    includesMarketing: false,
  },
  left: {
    initialCount: 4, // All users (Dave has null dept)
    userNames: [`Alice`, `Bob`, `Charlie`, `Dave`],
    includesDave: true,
    includesMarketing: false,
  },
  right: {
    initialCount: 4, // Alice+Eng, Bob+Eng, Charlie+Sales, null+Marketing
    userNames: [`Alice`, `Bob`, `Charlie`], // null user not counted
    includesDave: false,
    includesMarketing: true,
  },
  full: {
    initialCount: 5, // Alice+Eng, Bob+Eng, Charlie+Sales, Dave+null, null+Marketing
    userNames: [`Alice`, `Bob`, `Charlie`, `Dave`],
    includesDave: true,
    includesMarketing: true,
  },
} as const

function testJoinType(joinType: JoinType, autoIndex: `off` | `eager`) {
  describe(`${joinType} joins with autoIndex ${autoIndex}`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>
    let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection(autoIndex)
      departmentsCollection = createDepartmentsCollection(autoIndex)
    })

    test(`should perform ${joinType} join with explicit select`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType,
            )
            .select(({ user, dept }) => ({
              user_name: user?.name,
              department_name: dept?.name,
              budget: dept?.budget,
            })),
      })

      const results = joinQuery.toArray
      const expected = expectedResults[joinType]

      expect(results).toHaveLength(expected.initialCount)

      // Check specific behaviors for each join type
      if (joinType === `inner`) {
        // Inner join should only include matching records
        const userNames = results.map((r) => r.user_name).sort()
        expect(userNames).toEqual([`Alice`, `Bob`, `Charlie`])

        const alice = results.find((r) => r.user_name === `Alice`)
        expect(alice).toMatchObject({
          user_name: `Alice`,
          department_name: `Engineering`,
          budget: 100000,
        })
      }

      if (joinType === `left`) {
        // Left join should include all users, even Dave with null department
        const userNames = results.map((r) => r.user_name).sort()
        expect(userNames).toEqual([`Alice`, `Bob`, `Charlie`, `Dave`])

        const dave = results.find((r) => r.user_name === `Dave`)
        expect(dave).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
          budget: undefined,
        })
      }

      if (joinType === `right`) {
        // Right join should include all departments, even Marketing with no users
        const departmentNames = results.map((r) => r.department_name).sort()
        expect(departmentNames).toEqual([
          `Engineering`,
          `Engineering`,
          `Marketing`,
          `Sales`,
        ])

        const marketing = results.find((r) => r.department_name === `Marketing`)
        expect(marketing).toMatchObject({
          user_name: undefined,
          department_name: `Marketing`,
          budget: 60000,
        })
      }

      if (joinType === `full`) {
        // Full join should include all users and all departments
        expect(results).toHaveLength(5)

        const dave = results.find((r) => r.user_name === `Dave`)
        expect(dave).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
          budget: undefined,
        })

        const marketing = results.find((r) => r.department_name === `Marketing`)
        expect(marketing).toMatchObject({
          user_name: undefined,
          department_name: `Marketing`,
          budget: 60000,
        })
      }
    })

    test(`should perform ${joinType} join without select (namespaced result)`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType,
            ),
      })

      const results = joinQuery.toArray as Array<
        Partial<(typeof joinQuery.toArray)[number]>
      > // Type coercion to allow undefined properties in tests
      const expected = expectedResults[joinType]

      expect(results).toHaveLength(expected.initialCount)

      switch (joinType) {
        case `inner`: {
          // Inner join: all results should have both user and dept
          results.forEach((result) => {
            expect(result).toHaveProperty(`user`)
            expect(result).toHaveProperty(`dept`)
          })
          break
        }
        case `left`: {
          // Left join: all results have user, but Dave (id=4) has no dept
          results.forEach((result) => {
            expect(result).toHaveProperty(`user`)
          })
          results
            .filter((result) => result.user?.id === 4)
            .forEach((result) => {
              expect(result).not.toHaveProperty(`dept`)
            })
          results
            .filter((result) => result.user?.id !== 4)
            .forEach((result) => {
              expect(result).toHaveProperty(`dept`)
            })
          break
        }
        case `right`: {
          // Right join: all results have dept, but Marketing dept has no user
          results.forEach((result) => {
            expect(result).toHaveProperty(`dept`)
          })
          // Results with matching users should have user property
          results
            .filter((result) => result.dept?.id !== 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
            })
          // Marketing department (id=3) should not have user
          results
            .filter((result) => result.dept?.id === 3)
            .forEach((result) => {
              expect(result).not.toHaveProperty(`user`)
            })
          break
        }
        case `full`: {
          // Full join: combination of left and right behaviors
          // Dave (user id=4) should have user but no dept
          results
            .filter((result) => result.user?.id === 4)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
              expect(result).not.toHaveProperty(`dept`)
            })
          // Marketing (dept id=3) should have dept but no user
          results
            .filter((result) => result.dept?.id === 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`dept`)
              expect(result).not.toHaveProperty(`user`)
            })
          // Matched records should have both
          results
            .filter((result) => result.user?.id !== 4 && result.dept?.id !== 3)
            .forEach((result) => {
              expect(result).toHaveProperty(`user`)
              expect(result).toHaveProperty(`dept`)
            })
          break
        }
      }
    })

    test(`should handle live updates for ${joinType} joins - insert matching record`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType,
            )
            .select(({ user, dept }) => ({
              user_name: user?.name,
              department_name: dept?.name,
            })),
      })

      const initialSize = joinQuery.size

      // Insert a new user with existing department
      const newUser: User = {
        id: 5,
        name: `Eve`,
        email: `eve@example.com`,
        department_id: 1, // Engineering
      }

      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `insert`, value: newUser })
      usersCollection.utils.commit()

      // For all join types, adding a matching user should increase the count
      expect(joinQuery.size).toBe(initialSize + 1)

      const eve = joinQuery.get(5)
      if (eve) {
        expect(eve).toMatchObject({
          user_name: `Eve`,
          department_name: `Engineering`,
        })
      }
    })

    test(`should handle live updates for ${joinType} joins - delete record`, () => {
      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .join(
              { dept: departmentsCollection },
              ({ user, dept }) => eq(user.department_id, dept.id),
              joinType,
            )
            .select(({ user, dept }) => ({
              user_name: user?.name,
              department_name: dept?.name,
            })),
      })

      const initialSize = joinQuery.size

      // Delete Alice (user 1) - she has a matching department
      const alice = sampleUsers.find((u) => u.id === 1)!
      usersCollection.utils.begin()
      usersCollection.utils.write({ type: `delete`, value: alice })
      usersCollection.utils.commit()

      // The behavior depends on join type
      if (joinType === `inner` || joinType === `left`) {
        // Alice was contributing to the result, so count decreases
        expect(joinQuery.size).toBe(initialSize - 1)
        expect(joinQuery.get(1)).toBeUndefined()
      } else {
        // (joinType === `right` || joinType === `full`)
        // Alice was contributing, but the behavior might be different
        // This will depend on the exact implementation
        expect(joinQuery.get(1)).toBeUndefined()
      }
    })

    if (joinType === `left` || joinType === `full`) {
      test(`should handle null to match transition for ${joinType} joins`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                joinType,
              )
              .select(({ user, dept }) => ({
                user_name: user?.name,
                department_name: dept?.name,
              })),
        })

        // Initially Dave has null department
        const daveBefore = joinQuery.get(`[4,undefined]`)
        expect(daveBefore).toMatchObject({
          user_name: `Dave`,
          department_name: undefined,
        })

        const daveBefore2 = joinQuery.get(`[4,1]`)
        expect(daveBefore2).toBeUndefined()

        // Update Dave to have a department
        const updatedDave: User = {
          ...sampleUsers.find((u) => u.id === 4)!,
          department_id: 1, // Engineering
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `update`, value: updatedDave })
        usersCollection.utils.commit()

        const daveAfter = joinQuery.get(`[4,1]`)
        expect(daveAfter).toMatchObject({
          user_name: `Dave`,
          department_name: `Engineering`,
        })

        const daveAfter2 = joinQuery.get(`[4,undefined]`)
        expect(daveAfter2).toBeUndefined()
      })
    }

    if (joinType === `right` || joinType === `full`) {
      test(`should handle unmatched department for ${joinType} joins`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                joinType,
              )
              .select(({ user, dept }) => ({
                user_name: user?.name,
                department_name: dept?.name,
              })),
        })

        // Initially Marketing has no users
        const marketingResults = joinQuery.toArray.filter(
          (r) => r.department_name === `Marketing`,
        )
        expect(marketingResults).toHaveLength(1)
        expect(marketingResults[0]?.user_name).toBeUndefined()

        // Insert a user for Marketing department
        const newUser: User = {
          id: 5,
          name: `Eve`,
          email: `eve@example.com`,
          department_id: 3, // Marketing
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: newUser })
        usersCollection.utils.commit()

        // Should now have Eve in Marketing instead of null
        const updatedMarketingResults = joinQuery.toArray.filter(
          (r) => r.department_name === `Marketing`,
        )
        expect(updatedMarketingResults).toHaveLength(1)
        expect(updatedMarketingResults[0]).toMatchObject({
          user_name: `Eve`,
          department_name: `Marketing`,
        })
      })
    }

    test(`should handle WHERE clauses on nullable side of ${joinType} join`, () => {
      // This test checks the behavior of WHERE clauses that filter on the side of the join
      // that can produce NULL values. The behavior should differ based on join type.

      // Create a specific scenario for testing nullable WHERE clauses
      // We'll use a team/member scenario where teams may have no members
      type Team = {
        id: number
        name: string
        active: boolean
      }

      type TeamMember = {
        id: number
        team_id: number
        user_id: number
        role: string
      }

      const teams: Array<Team> = [
        { id: 1, name: `Team Alpha`, active: true },
        { id: 2, name: `Team Beta`, active: true },
        { id: 3, name: `Team Gamma`, active: false }, // This team has no members
      ]

      const teamMembers: Array<TeamMember> = [
        { id: 1, team_id: 1, user_id: 100, role: `admin` },
        { id: 2, team_id: 1, user_id: 200, role: `member` },
        { id: 3, team_id: 2, user_id: 100, role: `admin` },
        // Note: Team Gamma (id: 3) has no members
      ]

      const teamsCollection = createCollection(
        mockSyncCollectionOptions<Team>({
          id: `test-teams-where`,
          getKey: (team) => team.id,
          initialData: teams,
          autoIndex,
        }),
      )

      const teamMembersCollection = createCollection(
        mockSyncCollectionOptions<TeamMember>({
          id: `test-members-where`,
          getKey: (member) => member.id,
          initialData: teamMembers,
          autoIndex,
        }),
      )

      // Test WHERE clause that filters on the nullable side based on join type
      let joinQuery: any

      if (joinType === `left`) {
        // LEFT JOIN: teams LEFT JOIN members WHERE member.user_id = 100
        // Should return only teams where user 100 is a member
        joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ team: teamsCollection })
              .leftJoin({ member: teamMembersCollection }, ({ team, member }) =>
                eq(team.id, member.team_id),
              )
              .where(({ member }) => eq(member?.user_id, 100))
              .select(({ team, member }) => ({
                team_id: team.id,
                team_name: team.name,
                user_id: member?.user_id,
                role: member?.role,
              })),
        })
      } else if (joinType === `right`) {
        // RIGHT JOIN: teams RIGHT JOIN members WHERE team.active = true
        // Should return only members whose teams are active
        joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ team: teamsCollection })
              .rightJoin(
                { member: teamMembersCollection },
                ({ team, member }) => eq(team.id, member.team_id),
              )
              .where(({ team }) => eq(team?.active, true))
              .select(({ team, member }) => ({
                team_id: team?.id,
                team_name: team?.name,
                user_id: member.user_id,
                role: member.role,
              })),
        })
      } else if (joinType === `full`) {
        // FULL JOIN: teams FULL JOIN members WHERE member.role = 'admin'
        // Should return all teams with admin members, plus orphaned admins
        joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ team: teamsCollection })
              .fullJoin({ member: teamMembersCollection }, ({ team, member }) =>
                eq(team.id, member.team_id),
              )
              .where(({ member }) => eq(member?.role, `admin`))
              .select(({ team, member }) => ({
                team_id: team?.id,
                team_name: team?.name,
                user_id: member?.user_id,
                role: member?.role,
              })),
        })
      } else {
        // INNER JOIN: teams INNER JOIN members WHERE member.user_id = 100
        // Should return only teams where user 100 is a member (same as LEFT but no nulls)
        joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ team: teamsCollection })
              .innerJoin(
                { member: teamMembersCollection },
                ({ team, member }) => eq(team.id, member.team_id),
              )
              .where(({ member }) => eq(member.user_id, 100))
              .select(({ team, member }) => ({
                team_id: team.id,
                team_name: team.name,
                user_id: member.user_id,
                role: member.role,
              })),
        })
      }

      const results = joinQuery.toArray

      // Type the results properly based on our expected structure
      type JoinResult = {
        team_id: number | null
        team_name: string | null
        user_id: number | null
        role: string | null
      }

      const typedResults = results as Array<JoinResult>

      // Verify expected behavior based on join type
      switch (joinType) {
        case `inner`:
          // INNER JOIN with WHERE member.user_id = 100
          // Should return 2 results: Team Alpha and Team Beta (both have user 100)
          expect(typedResults).toHaveLength(2)
          expect(typedResults.every((r) => r.user_id === 100)).toBe(true)
          expect(typedResults.map((r) => r.team_name).sort()).toEqual([
            `Team Alpha`,
            `Team Beta`,
          ])
          break

        case `left`:
          // LEFT JOIN with WHERE member.user_id = 100
          // Should return 2 results: only teams where user 100 is actually a member
          // Team Gamma should be filtered out because member.user_id would be null
          expect(typedResults).toHaveLength(2)
          expect(typedResults.every((r) => r.user_id === 100)).toBe(true)
          expect(typedResults.map((r) => r.team_name).sort()).toEqual([
            `Team Alpha`,
            `Team Beta`,
          ])
          break

        case `right`:
          // RIGHT JOIN with WHERE team.active = true
          // Should return 3 results: all members whose teams are active
          // (All existing teams are active)
          expect(typedResults).toHaveLength(3)
          expect(typedResults.every((r) => r.team_id !== null)).toBe(true)
          expect(typedResults.map((r) => r.user_id).sort()).toEqual([
            100, 100, 200,
          ])
          break

        case `full`:
          // FULL JOIN with WHERE member.role = 'admin'
          // Should return 2 results: Team Alpha + user 100, Team Beta + user 100
          expect(typedResults).toHaveLength(2)
          expect(typedResults.every((r) => r.role === `admin`)).toBe(true)
          expect(typedResults.map((r) => r.user_id).sort()).toEqual([100, 100])
          break
      }
    })

    test(`should handle chained joins for ${joinType} joins`, () => {
      // Test schema for chained joins - using simpler data to focus on the core functionality
      type Company = {
        id: number
        name: string
      }

      type Project = {
        id: number
        name: string
        company_id: number
      }

      type Task = {
        id: number
        name: string
        project_id: number
      }

      // Simple data with complete chains for easier testing
      const companies: Array<Company> = [
        { id: 1, name: `TechCorp` },
        { id: 2, name: `DataInc` },
      ]

      const projects: Array<Project> = [
        { id: 1, name: `Website`, company_id: 1 },
        { id: 2, name: `Analytics`, company_id: 2 },
      ]

      const tasks: Array<Task> = [
        { id: 1, name: `Design`, project_id: 1 },
        { id: 2, name: `Research`, project_id: 2 },
      ]

      const companiesCollection = createCollection(
        mockSyncCollectionOptions<Company>({
          id: `test-companies-${joinType}-${autoIndex}`,
          getKey: (company) => company.id,
          initialData: companies,
          autoIndex,
        }),
      )

      const projectsCollection = createCollection(
        mockSyncCollectionOptions<Project>({
          id: `test-projects-${joinType}-${autoIndex}`,
          getKey: (project) => project.id,
          initialData: projects,
          autoIndex,
        }),
      )

      const tasksCollection = createCollection(
        mockSyncCollectionOptions<Task>({
          id: `test-tasks-${joinType}-${autoIndex}`,
          getKey: (task) => task.id,
          initialData: tasks,
          autoIndex,
        }),
      )

      // Create chained join query: Company -> Project -> Task
      // The key test: the second join references the first joined table (project)
      const chainedJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ company: companiesCollection })
            .join(
              { project: projectsCollection },
              ({ company, project }) => eq(project.company_id, company.id),
              joinType,
            )
            .join(
              { task: tasksCollection },
              ({ task, project }) => eq(task.project_id, project?.id),
              joinType,
            )
            .select(({ company, project, task }) => ({
              company_name: company?.name,
              project_name: project?.name,
              task_name: task?.name,
            })),
      })

      const results = chainedJoinQuery.toArray

      // The key assertion: chained joins should work regardless of join type
      expect(results.length).toBeGreaterThan(0)

      // For all join types, we should be able to find the complete chains
      const techCorpChain = results.find(
        (r) =>
          r.company_name === `TechCorp` &&
          r.project_name === `Website` &&
          r.task_name === `Design`,
      )
      const dataIncChain = results.find(
        (r) =>
          r.company_name === `DataInc` &&
          r.project_name === `Analytics` &&
          r.task_name === `Research`,
      )

      expect(techCorpChain).toBeDefined()
      expect(dataIncChain).toBeDefined()

      // Test incremental updates work correctly for this join type
      const newTask: Task = {
        id: 3,
        name: `New Task`,
        project_id: 1, // Website project
      }

      const initialCount = results.length

      tasksCollection.utils.begin()
      tasksCollection.utils.write({ type: `insert`, value: newTask })
      tasksCollection.utils.commit()

      const resultsAfterInsert = chainedJoinQuery.toArray

      // All join types should handle the new task insertion
      expect(resultsAfterInsert.length).toBeGreaterThanOrEqual(initialCount)

      const newTaskResult = resultsAfterInsert.find(
        (r) => r.task_name === `New Task`,
      )
      expect(newTaskResult).toBeDefined()
      expect(newTaskResult!.project_name).toBe(`Website`)
      expect(newTaskResult!.company_name).toBe(`TechCorp`)
    })
  })
}

function createJoinTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    // Generate tests for each join type
    joinTypes.forEach((joinType) => {
      testJoinType(joinType, autoIndex)
    })

    describe(`Complex Join Scenarios`, () => {
      let usersCollection: ReturnType<typeof createUsersCollection>
      let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

      beforeEach(() => {
        usersCollection = createUsersCollection(autoIndex)
        departmentsCollection = createDepartmentsCollection(autoIndex)
      })

      test(`should handle multiple simultaneous updates`, () => {
        const innerJoinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                `inner`,
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        expect(innerJoinQuery.size).toBe(3)

        // Perform multiple operations in a single transaction
        usersCollection.utils.begin()
        departmentsCollection.utils.begin()

        // Delete Alice
        const alice = sampleUsers.find((u) => u.id === 1)!
        usersCollection.utils.write({ type: `delete`, value: alice })

        // Add new user Eve to Engineering
        const eve: User = {
          id: 5,
          name: `Eve`,
          email: `eve@example.com`,
          department_id: 1,
        }
        usersCollection.utils.write({ type: `insert`, value: eve })

        // Add new department IT
        const itDept: Department = { id: 4, name: `IT`, budget: 120000 }
        departmentsCollection.utils.write({ type: `insert`, value: itDept })

        // Update Dave to join IT
        const updatedDave: User = {
          ...sampleUsers.find((u) => u.id === 4)!,
          department_id: 4,
        }
        usersCollection.utils.write({ type: `update`, value: updatedDave })

        usersCollection.utils.commit()
        departmentsCollection.utils.commit()

        // Should still have 4 results: Bob+Eng, Charlie+Sales, Eve+Eng, Dave+IT
        expect(innerJoinQuery.size).toBe(4)

        const resultNames = innerJoinQuery.toArray
          .map((r) => r.user_name)
          .sort()
        expect(resultNames).toEqual([`Bob`, `Charlie`, `Dave`, `Eve`])

        const daveResult = innerJoinQuery.toArray.find(
          (r) => r.user_name === `Dave`,
        )
        expect(daveResult).toMatchObject({
          user_name: `Dave`,
          department_name: `IT`,
        })
      })

      test(`should handle empty collections`, () => {
        const emptyUsers = createCollection(
          mockSyncCollectionOptions<User>({
            id: `empty-users`,
            getKey: (user) => user.id,
            initialData: [],
          }),
        )

        const innerJoinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: emptyUsers })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                `inner`,
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        expect(innerJoinQuery.size).toBe(0)

        // Add user to empty collection
        const newUser: User = {
          id: 1,
          name: `Alice`,
          email: `alice@example.com`,
          department_id: 1,
        }
        emptyUsers.utils.begin()
        emptyUsers.utils.write({ type: `insert`, value: newUser })
        emptyUsers.utils.commit()

        expect(innerJoinQuery.size).toBe(1)
        const result = innerJoinQuery.get(`[1,1]`)
        expect(result).toMatchObject({
          user_name: `Alice`,
          department_name: `Engineering`,
        })
      })

      test(`should handle null join keys correctly`, () => {
        // Test with user that has null department_id
        const leftJoinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                `left`,
              )
              .select(({ user, dept }) => ({
                user_id: user.id,
                user_name: user.name,
                department_id: user.department_id,
                department_name: dept?.name,
              })),
        })

        const results = leftJoinQuery.toArray
        expect(results).toHaveLength(4)

        // Dave has null department_id
        const dave = results.find((r) => r.user_name === `Dave`)
        expect(dave).toMatchObject({
          user_id: 4,
          user_name: `Dave`,
          department_id: undefined,
          department_name: undefined,
        })

        // Other users should have department names
        const alice = results.find((r) => r.user_name === `Alice`)
        expect(alice?.department_name).toBe(`Engineering`)
      })

      test(`should handle joins with computed expressions`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) =>
                  eq(
                    concat(`dept`, user.department_id),
                    concat(`dept`, dept.id),
                  ),
                `inner`,
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        expect(joinQuery.size).toBe(3)
      })

      test(`should match Date join keys by timestamp instead of object reference`, () => {
        type DateLeft = { id: number; joinedAt: Date; name: string }
        type DateRight = { id: number; joinedAt: Date; label: string }

        const baseTimestamp = Date.parse(`2025-01-15T12:34:56.789Z`)

        const leftData: Array<DateLeft> = [
          { id: 1, joinedAt: new Date(baseTimestamp), name: `left-1` },
        ]
        const rightData: Array<DateRight> = [
          { id: 10, joinedAt: new Date(baseTimestamp), label: `right-10` },
        ]

        // Guard against accidentally sharing the same Date object instance.
        expect(leftData[0]!.joinedAt).not.toBe(rightData[0]!.joinedAt)
        expect(leftData[0]!.joinedAt.getTime()).toBe(
          rightData[0]!.joinedAt.getTime(),
        )

        const leftCollection = createCollection(
          mockSyncCollectionOptions<DateLeft>({
            id: `join-date-left-${autoIndex}`,
            getKey: (row) => row.id,
            initialData: leftData,
            autoIndex,
          }),
        )
        const rightCollection = createCollection(
          mockSyncCollectionOptions<DateRight>({
            id: `join-date-right-${autoIndex}`,
            getKey: (row) => row.id,
            initialData: rightData,
            autoIndex,
          }),
        )

        const query = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ left: leftCollection })
              .innerJoin({ right: rightCollection }, ({ left, right }) =>
                eq(left.joinedAt, right.joinedAt),
              )
              .select(({ left, right }) => ({
                leftId: left.id,
                rightId: right.id,
              })),
        })

        expect(query.toArray).toHaveLength(1)
        expect(query.toArray[0]).toEqual({ leftId: 1, rightId: 10 })
      })

      test(`should update Date join matches when timestamp changes`, () => {
        type DateLeft = { id: number; joinedAt: Date; name: string }
        type DateRight = { id: number; joinedAt: Date; label: string }

        const baseTimestamp = Date.parse(`2025-01-15T12:34:56.789Z`)

        const leftCollection = createCollection(
          mockSyncCollectionOptions<DateLeft>({
            id: `join-date-update-left-${autoIndex}`,
            getKey: (row) => row.id,
            initialData: [
              { id: 1, joinedAt: new Date(baseTimestamp), name: `left-1` },
            ],
            autoIndex,
          }),
        )
        const rightCollection = createCollection(
          mockSyncCollectionOptions<DateRight>({
            id: `join-date-update-right-${autoIndex}`,
            getKey: (row) => row.id,
            initialData: [
              {
                id: 10,
                joinedAt: new Date(baseTimestamp + 1),
                label: `right-10`,
              },
            ],
            autoIndex,
          }),
        )

        const query = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ left: leftCollection })
              .innerJoin({ right: rightCollection }, ({ left, right }) =>
                eq(left.joinedAt, right.joinedAt),
              )
              .select(({ left, right }) => ({
                leftId: left.id,
                rightId: right.id,
              })),
        })

        expect(query.toArray).toHaveLength(0)

        rightCollection.utils.begin()
        rightCollection.utils.write({
          type: `update`,
          value: {
            id: 10,
            joinedAt: new Date(baseTimestamp),
            label: `right-10`,
          },
        })
        rightCollection.utils.commit()

        expect(query.toArray).toHaveLength(1)
        expect(query.toArray[0]).toEqual({ leftId: 1, rightId: 10 })
      })
    })

    test(`should handle chained joins with incremental updates`, () => {
      // Test schema for chained joins scenario
      type Player = {
        name: string
        club_id: string
        position: string
      }

      type Client = {
        name: string
        player: string // references Player.name

        email: string
      }

      type Balance = {
        name: string
        client: string // references Client.name
        amount: number
      }

      // Sample data
      const samplePlayers: Array<Player> = [
        { name: `player1`, club_id: `club1`, position: `forward` },
        { name: `player2`, club_id: `club1`, position: `midfielder` },
        { name: `player3`, club_id: `club1`, position: `defender` },
      ]

      const sampleClients: Array<Client> = [
        { name: `client1`, player: `player1`, email: `client1@example.com` },
        { name: `client2`, player: `player2`, email: `client2@example.com` },
        { name: `client3`, player: `player3`, email: `client3@example.com` },
      ]

      const sampleBalances: Array<Balance> = [
        { name: `balance1`, client: `client1`, amount: 1000 },
        { name: `balance2`, client: `client2`, amount: 2000 },
        { name: `balance3`, client: `client3`, amount: 1500 },
      ]

      const playersCollection = createCollection(
        mockSyncCollectionOptions<Player>({
          id: `test-players-chained-${autoIndex}`,
          getKey: (player) => player.name,
          initialData: samplePlayers,
          autoIndex,
        }),
      )

      const clientsCollection = createCollection(
        mockSyncCollectionOptions<Client>({
          id: `test-clients-chained-${autoIndex}`,
          getKey: (client) => client.name,
          initialData: sampleClients,
          autoIndex,
        }),
      )

      const balancesCollection = createCollection(
        mockSyncCollectionOptions<Balance>({
          id: `test-balances-chained-${autoIndex}`,
          getKey: (balance) => balance.name,
          initialData: sampleBalances,
          autoIndex,
        }),
      )

      // Create chained join query: Player -> Client -> Balance
      // This reproduces the exact scenario from the bug report
      // where the second join joins against the previously joined collection (client)
      // Using inner joins to ensure we only get complete chains
      const chainedJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ player: playersCollection })
            .innerJoin({ client: clientsCollection }, ({ client, player }) =>
              eq(client.player, player.name),
            )
            .innerJoin({ balance: balancesCollection }, ({ balance, client }) =>
              eq(balance.client, client.name),
            )
            .select(({ player, client, balance }) => ({
              player_name: player.name,
              client_name: client.name,
              balance_amount: balance.amount,
              player_position: player.position,
              client_email: client.email,
            })),
      })

      const initialResults = chainedJoinQuery.toArray

      // Should have 3 results - one for each player-client-balance chain
      expect(initialResults).toHaveLength(3)

      // Verify the initial structure
      const result1 = initialResults.find((r) => r.player_name === `player1`)
      expect(result1).toBeDefined()
      expect(result1!.client_name).toBe(`client1`)
      expect(result1!.balance_amount).toBe(1000)

      // Test 1: Update a middle collection (client)
      const updatedClient: Client = {
        name: `client1`,
        player: `player1`,
        email: `updated-client1@example.com`, // Changed email
      }

      clientsCollection.utils.begin()
      clientsCollection.utils.write({ type: `update`, value: updatedClient })
      clientsCollection.utils.commit()

      const resultsAfterClientUpdate = chainedJoinQuery.toArray
      expect(resultsAfterClientUpdate).toHaveLength(3)

      const updatedResult1 = resultsAfterClientUpdate.find(
        (r) => r.player_name === `player1`,
      )
      expect(updatedResult1!.client_email).toBe(`updated-client1@example.com`)
      expect(updatedResult1!.balance_amount).toBe(1000) // Balance should remain the same

      // Test 2: Update the latter collection (balance)
      const updatedBalance: Balance = {
        name: `balance2`,
        client: `client2`,
        amount: 3000, // Changed amount
      }

      balancesCollection.utils.begin()
      balancesCollection.utils.write({
        type: `update`,
        value: updatedBalance,
      })
      balancesCollection.utils.commit()

      const resultsAfterBalanceUpdate = chainedJoinQuery.toArray
      expect(resultsAfterBalanceUpdate).toHaveLength(3)

      const updatedResult2 = resultsAfterBalanceUpdate.find(
        (r) => r.player_name === `player2`,
      )
      expect(updatedResult2!.balance_amount).toBe(3000) // Updated amount
      expect(updatedResult2!.client_name).toBe(`client2`) // Client should remain the same

      // Test 3: Insert into middle collection (client)
      const newClient: Client = {
        name: `client4`,
        player: `player1`, // Same player as client1
        email: `client4@example.com`,
      }

      clientsCollection.utils.begin()
      clientsCollection.utils.write({ type: `insert`, value: newClient })
      clientsCollection.utils.commit()

      // This should not increase the result count because there's no balance for client4
      const resultsAfterClientInsert = chainedJoinQuery.toArray
      expect(resultsAfterClientInsert).toHaveLength(3)

      // Test 4: Insert into latter collection (balance) to complete the chain
      const newBalance: Balance = {
        name: `balance4`,
        client: `client4`,
        amount: 2500,
      }

      balancesCollection.utils.begin()
      balancesCollection.utils.write({ type: `insert`, value: newBalance })
      balancesCollection.utils.commit()

      // Now we should have 4 results because client4 now has a balance
      const resultsAfterBalanceInsert = chainedJoinQuery.toArray
      expect(resultsAfterBalanceInsert).toHaveLength(4)

      const newResult = resultsAfterBalanceInsert.find(
        (r) => r.client_name === `client4`,
      )
      expect(newResult).toBeDefined()
      expect(newResult!.player_name).toBe(`player1`)
      expect(newResult!.balance_amount).toBe(2500)

      // Test 5: Delete from middle collection (client)
      clientsCollection.utils.begin()
      clientsCollection.utils.write({ type: `delete`, value: newClient })
      clientsCollection.utils.commit()

      // Should go back to 3 results as the chain is broken
      const resultsAfterClientDelete = chainedJoinQuery.toArray
      expect(resultsAfterClientDelete).toHaveLength(3)
      expect(
        resultsAfterClientDelete.find((r) => r.client_name === `client4`),
      ).toBeUndefined()
    })

    test(`should self-join`, () => {
      // This test reproduces the exact scenario from the bug report
      type SelfJoinUser = {
        id: number
        name: string
        parentId: number | undefined
      }

      const selfJoinSampleUsers: Array<SelfJoinUser> = [
        { id: 1, name: `Alice`, parentId: undefined },
        { id: 2, name: `Bob`, parentId: 1 },
        { id: 3, name: `Charlie`, parentId: 1 },
        { id: 4, name: `Dave`, parentId: 2 },
        { id: 5, name: `Eve`, parentId: 3 },
      ]

      const selfJoinUsersCollection = createCollection(
        mockSyncCollectionOptions<SelfJoinUser>({
          id: `test-users-self-join`,
          getKey: (user) => user.id,
          initialData: selfJoinSampleUsers,
        }),
      )

      const selfJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: selfJoinUsersCollection })
            .join(
              { parentUsers: selfJoinUsersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`,
            )
            .select(({ users, parentUsers }) => ({
              user_id: users.id,
              user_name: users.name,
              parent_id: parentUsers.id,
              parent_name: parentUsers.name,
            })),
      })

      const results = selfJoinQuery.toArray

      // Should have 4 results: Bob->Alice, Charlie->Alice, Dave->Bob, Eve->Charlie
      expect(results).toHaveLength(4)

      // Check specific relationships
      const bobResult = results.find((r) => r.user_name === `Bob`)
      expect(bobResult).toMatchObject({
        user_id: 2,
        user_name: `Bob`,
        parent_id: 1,
        parent_name: `Alice`,
      })

      const daveResult = results.find((r) => r.user_name === `Dave`)
      expect(daveResult).toMatchObject({
        user_id: 4,
        user_name: `Dave`,
        parent_id: 2,
        parent_name: `Bob`,
      })

      // Alice should not appear as a user (she has no parent)
      const aliceAsUser = results.find((r) => r.user_name === `Alice`)
      expect(aliceAsUser).toBeUndefined()

      // Alice should appear as a parent
      const aliceAsParent = results.find((r) => r.parent_name === `Alice`)
      expect(aliceAsParent).toBeDefined()
    })

    test(`should handle both directions of eq expression in joins`, () => {
      // Test that both eq(users.parentId, parentUsers.id) and eq(parentUsers.id, users.parentId) work
      type BidirectionalUser = {
        id: number
        name: string
        parentId: number | undefined
      }

      const bidirectionalSampleUsers: Array<BidirectionalUser> = [
        { id: 1, name: `Alice`, parentId: undefined },
        { id: 2, name: `Bob`, parentId: 1 },
        { id: 3, name: `Charlie`, parentId: 1 },
      ]

      const bidirectionalUsersCollection = createCollection(
        mockSyncCollectionOptions<BidirectionalUser>({
          id: `test-users-bidirectional`,
          getKey: (user) => user.id,
          initialData: bidirectionalSampleUsers,
        }),
      )

      // Test forward direction: eq(users.parentId, parentUsers.id)
      const forwardJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: bidirectionalUsersCollection })
            .join(
              { parentUsers: bidirectionalUsersCollection },
              ({ users, parentUsers }) => eq(users.parentId, parentUsers.id),
              `inner`,
            )
            .select(({ users, parentUsers }) => ({
              user_name: users.name,
              parent_name: parentUsers.name,
            })),
      })

      const forwardResults = forwardJoinQuery.toArray
      expect(forwardResults).toHaveLength(2) // Bob->Alice, Charlie->Alice

      // Test reverse direction: eq(parentUsers.id, users.parentId)
      const reverseJoinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ users: bidirectionalUsersCollection })
            .join(
              { parentUsers: bidirectionalUsersCollection },
              ({ users, parentUsers }) => eq(parentUsers.id, users.parentId),
              `inner`,
            )
            .select(({ users, parentUsers }) => ({
              user_name: users.name,
              parent_name: parentUsers.name,
            })),
      })

      const reverseResults = reverseJoinQuery.toArray
      expect(reverseResults).toHaveLength(2) // Bob->Alice, Charlie->Alice

      // Both should produce identical results
      expect(forwardResults).toEqual(reverseResults)

      // Verify the results are correct
      const bobForward = forwardResults.find((r) => r.user_name === `Bob`)
      const bobReverse = reverseResults.find((r) => r.user_name === `Bob`)
      expect(bobForward).toEqual(bobReverse)
      expect(bobForward).toMatchObject({
        user_name: `Bob`,
        parent_name: `Alice`,
      })
    })

    test(`should throw error when both expressions refer to the same source`, () => {
      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-same-table`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        }),
      )

      const departmentsCollection = createDepartmentsCollection(autoIndex)

      expect(() => {
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ user: usersCollection }).join(
              { dept: departmentsCollection },
              ({ user }) => eq(user.id, user.department_id), // Both refer to 'user' table
              `inner`,
            ),
        })
      }).toThrow(
        `Invalid join condition: both expressions refer to the same source "user"`,
      )
    })

    test(`should throw error when expressions don't reference source aliases`, () => {
      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-no-refs`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        }),
      )

      const departmentsCollection = createDepartmentsCollection(autoIndex)

      expect(() => {
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ user: usersCollection }).join(
              { dept: departmentsCollection },
              () => eq(1, 2), // Constants, no table references
              `inner`,
            ),
        })
      }).toThrow(
        `Invalid join condition: expressions must reference source aliases`,
      )
    })

    test(`should throw error when right side doesn't match joined source`, () => {
      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-no-refs`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        }),
      )

      const departmentsCollection = createDepartmentsCollection(autoIndex)

      const departmentsCollection2 = createDepartmentsCollection(autoIndex)

      expect(() => {
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(dept.id, user.department_id),
                `inner`,
              )
              .join(
                { dept2: departmentsCollection2 },
                ({ user, dept }) => eq(dept.id, user.department_id),
                `inner`,
              ),
        })
      }).toThrow(
        `Invalid join condition: right expression does not refer to the joined source "dept2"`,
      )
    })

    test(`should throw error when function expression has mixed source references`, () => {
      const usersCollection = createCollection(
        mockSyncCollectionOptions<User>({
          id: `test-users-mixed-refs`,
          getKey: (user) => user.id,
          initialData: sampleUsers,
        }),
      )

      const departmentsCollection = createDepartmentsCollection(autoIndex)

      expect(() => {
        createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ user: usersCollection }).join(
              { dept: departmentsCollection },
              ({ user }) => eq(user.id, user.department_id), // Both refer to 'user' table
              `inner`,
            ),
        })
      }).toThrow(
        `Invalid join condition: both expressions refer to the same source "user"`,
      )
    })

    test(`should not push down isUndefined(namespace) to subquery`, () => {
      const usersCollection = createUsersCollection()
      const specialUsersCollection = createCollection(
        mockSyncCollectionOptions({
          id: `special-users`,
          getKey: (user) => user.id,
          initialData: [{ id: 1, special: true }],
        }),
      )

      const joinQuery = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .leftJoin(
              { special: specialUsersCollection },
              ({ user, special }) => eq(user.id, special.id),
            )
            .where(({ special }) => isUndefined(special)),
      })

      // Should return users that don't have a matching special user
      // This should be users with IDs 2, 3, 4 (since only user 1 has a special record)
      const results = joinQuery.toArray
      expect(results).toHaveLength(3)

      // All results should have special as undefined
      for (const row of results) {
        expect(row.special).toBeUndefined()
      }

      // Should not include user 1 (Alice) since she has a special record
      const aliceResult = results.find((r) => r.user.id === 1)
      expect(aliceResult).toBeUndefined()

      // Should include users 2, 3, 4 (Bob, Charlie, Dave)
      const userIds = results.map((r) => r.user.id).sort()
      expect(userIds).toEqual([2, 3, 4])
    })

    test(`should handle where clause on a self-join query`, () => {
      // This test reproduces the bug where a WHERE clause combined with a LEFT JOIN
      // on the same collection causes the joined parent to be undefined
      type Event = {
        id: string
        parent_id: string | undefined
        name: string
      }

      const sampleEvents: Array<Event> = [
        {
          id: `ba224e71-a464-418d-a0a9-5959b490775d`,
          parent_id: undefined,
          name: `Parent Event`,
        },
        {
          id: `3770a4a6-3260-4566-9f79-f50864ebdd46`,
          parent_id: `ba224e71-a464-418d-a0a9-5959b490775d`,
          name: `Child Event`,
        },
        {
          id: `another-child-id`,
          parent_id: `ba224e71-a464-418d-a0a9-5959b490775d`,
          name: `Another Child`,
        },
      ]

      const eventCollection = createCollection(
        mockSyncCollectionOptions<Event>({
          id: `test-events-self-join-bug`,
          getKey: (event) => event.id,
          initialData: sampleEvents,
          autoIndex,
        }),
      )

      const queryWithWhere = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ event: eventCollection })
            .where(({ event }) =>
              eq(event.id, `3770a4a6-3260-4566-9f79-f50864ebdd46`),
            )
            .join(
              { parent: eventCollection },
              ({ event, parent }) => eq(parent.id, event.parent_id),
              `left`,
            )
            .select(({ event, parent }) => ({
              id: event.id,
              parent_id: event.parent_id,
              parent: {
                id: parent?.id,
              },
            })),
      })

      const resultsWithWhere = queryWithWhere.toArray
      expect(resultsWithWhere).toHaveLength(1)

      const childEventWithWhere = resultsWithWhere[0]!
      expect(childEventWithWhere).toBeDefined()

      expect(childEventWithWhere.id).toBe(
        `3770a4a6-3260-4566-9f79-f50864ebdd46`,
      )
      expect(childEventWithWhere.parent_id).toBe(
        `ba224e71-a464-418d-a0a9-5959b490775d`,
      )
      expect(childEventWithWhere.parent.id).toBe(
        `ba224e71-a464-418d-a0a9-5959b490775d`,
      )
    })

    test(`should handle self-join with different WHERE clauses on each alias`, () => {
      // This test ensures that different aliases of the same collection
      // can maintain independent WHERE filters in per-alias subscriptions
      type Person = {
        id: number
        name: string
        age: number
        manager_id: number | undefined
      }

      const samplePeople: Array<Person> = [
        { id: 1, name: `Alice`, age: 35, manager_id: undefined },
        { id: 2, name: `Bob`, age: 40, manager_id: 1 },
        { id: 3, name: `Charlie`, age: 28, manager_id: 2 },
        { id: 4, name: `Dave`, age: 32, manager_id: 2 },
        { id: 5, name: `Eve`, age: 45, manager_id: 1 },
      ]

      const peopleCollection = createCollection(
        mockSyncCollectionOptions<Person>({
          id: `test-people-self-join-where`,
          getKey: (person) => person.id,
          initialData: samplePeople,
          autoIndex,
        }),
      )

      // Query: Find employees aged > 30 and their managers aged > 35
      const selfJoinWithFilters = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ employee: peopleCollection })
            .where(({ employee }) => gt(employee.age, 30))
            .join(
              { manager: peopleCollection },
              ({ employee, manager }) => eq(employee.manager_id, manager.id),
              `left`,
            )
            .where(({ manager }) =>
              or(isNull(manager?.id), gt(manager?.age, 35)),
            )
            .select(({ employee, manager }) => ({
              employeeId: employee.id,
              employeeName: employee.name,
              employeeAge: employee.age,
              managerId: manager?.id,
              managerName: manager?.name,
              managerAge: manager?.age,
            })),
      })

      const results = selfJoinWithFilters.toArray

      // Expected logic:
      // - Alice (35, no manager) - employee filter passes (35 > 30), manager is null so filter passes
      // - Bob (40, manager Alice 35) - employee filter passes (40 > 30), but manager filter fails (35 NOT > 35)
      // - Charlie (28, manager Bob 40) - employee filter fails (28 NOT > 30)
      // - Dave (32, manager Bob 40) - employee filter passes (32 > 30), manager filter passes (40 > 35)
      // - Eve (45, manager Alice 35) - employee filter passes (45 > 30), but manager filter fails (35 NOT > 35)

      // The optimizer pushes WHERE clauses into subqueries, so:
      // - "employee" alias gets: WHERE age > 30
      // - "manager" alias gets: WHERE age > 35 OR id IS NULL (but manager join is LEFT, so null handling is different)

      // After optimization, only Dave should match because:
      // - His age (32) > 30 (employee filter)
      // - His manager Bob's age (40) > 35 (manager filter)
      // Alice would match if the isNull check works correctly for outer joins

      // Let's verify we get at least Dave
      expect(results.length).toBeGreaterThanOrEqual(1)

      const dave = results.find((r) => r.employeeId === 4)
      expect(dave).toBeDefined()
      expect(dave!.employeeName).toBe(`Dave`)
      expect(dave!.employeeAge).toBe(32)
      expect(dave!.managerId).toBe(2)
      expect(dave!.managerName).toBe(`Bob`)
      expect(dave!.managerAge).toBe(40)
    })
  })

  test(`should handle multiple joins with where clauses to the same source collection`, () => {
    type Collection1 = {
      id: number
      value: number
    }

    type Collection2 = {
      id: number
      value: number
      other: number
    }

    const collection1Data: Array<Collection1> = [{ id: 1, value: 1 }]

    const collection2Data: Array<Collection2> = [
      { id: 1, value: 1, other: 10 },
      { id: 2, value: 1, other: 30 },
    ]

    const collection1 = createCollection(
      mockSyncCollectionOptions<Collection1>({
        id: `test-collection1-multiple-joins`,
        getKey: (item) => item.id,
        initialData: collection1Data,
        autoIndex,
      }),
    )

    const collection2 = createCollection(
      mockSyncCollectionOptions<Collection2>({
        id: `test-collection2-multiple-joins`,
        getKey: (item) => item.id,
        initialData: collection2Data,
        autoIndex,
      }),
    )

    const multipleJoinQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ main: collection1 })
          .join(
            {
              join1: q
                .from({ join1: collection2 })
                .where(({ join1 }) => not(gt(join1.other, 20))),
            },
            ({ main, join1 }) => eq(main.value, join1.value),
            `left`,
          )
          .join(
            {
              join2: q
                .from({ join2: collection2 })
                .where(({ join2 }) => not(lt(join2.other, 20))),
            },
            ({ main, join2 }) => eq(main.value, join2.value),
            `left`,
          ),
    })

    const multipleResults = multipleJoinQuery.toArray

    // This should work - we're filtering for records where join1 has 'a' AND join2 has 'b'
    // But it might fail due to the sequential WHERE clause issue
    expect(multipleResults).toHaveLength(1)

    const result = multipleResults[0]!
    expect(result).toBeDefined()

    // Should have the main item
    expect(result.main.id).toBe(1)

    // Should have both joined items with their respective filters
    expect(result.join1).toBeDefined()
    expect(result.join1!.id).toBe(1)
    expect(result.join1!.value).toBe(1)
    expect(result.join1!.other).toBe(10)

    expect(result.join2).toBeDefined()
    expect(result.join2!.id).toBe(2)
    expect(result.join2!.value).toBe(1)
    expect(result.join2!.other).toBe(30)
  })

  test(`where with isUndefined on right-side field should filter entire joined rows`, () => {
    type Left = {
      id: string
      rightId: string | null
    }

    type Right = {
      id: string
      payload: string | null | undefined
    }

    const leftCollection = createCollection(
      mockSyncCollectionOptions<Left>({
        id: `test-left-isundefined-field`,
        getKey: (item) => item.id,
        initialData: [
          { id: `l1`, rightId: `r1` },
          { id: `l2`, rightId: `r2` },
          { id: `l3`, rightId: `r3` },
          { id: `l4`, rightId: null },
        ],
        autoIndex,
      }),
    )

    const rightCollection = createCollection(
      mockSyncCollectionOptions<Right>({
        id: `test-right-isundefined-field`,
        getKey: (item) => item.id,
        initialData: [
          { id: `r1`, payload: `ok` },
          { id: `r2`, payload: null },
          { id: `r3`, payload: undefined },
        ],
        autoIndex,
      }),
    )

    const lq = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ l: leftCollection })
          .leftJoin({ r: rightCollection }, ({ l, r }) => eq(l.rightId, r.id))
          .where(({ r }) => isUndefined(r?.payload))
          .select(({ l, r }) => ({ leftId: l.id, right: r })),
    })

    const data = lq.toArray

    // l1 joins r1 (payload='ok') → payload is defined → exclude
    // l2 joins r2 (payload=null) → payload is null, not undefined → exclude
    // l3 joins r3 (payload=undefined) → payload is undefined → include
    // l4 has no match (rightId=null) → right is undefined, so r?.payload is undefined → include
    expect(data.sort((a, b) => a.leftId.localeCompare(b.leftId))).toEqual([
      { leftId: `l3`, right: { id: `r3`, payload: undefined } },
      { leftId: `l4`, right: undefined },
    ])
  })
}

describe(`Query JOIN Operations`, () => {
  createJoinTests(`off`)
  createJoinTests(`eager`)
})
