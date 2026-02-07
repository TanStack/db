import { beforeEach, describe, expect, test } from 'vitest'
import { createLiveQueryCollection, eq, gt } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'

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

type Profile = {
  id: number
  userId: number
  bio: string
  avatar: string
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

const sampleProfiles: Array<Profile> = [
  {
    id: 1,
    userId: 1,
    bio: `Senior developer with 10 years experience`,
    avatar: `alice.jpg`,
  },
  {
    id: 2,
    userId: 2,
    bio: `Full-stack engineer`,
    avatar: `bob.jpg`,
  },
  {
    id: 3,
    userId: 3,
    bio: `Frontend specialist`,
    avatar: `charlie.jpg`,
  },
]

const sampleProducts = [
  { id: 1, a: `8` },
  { id: 2, a: `6` },
  { id: 3, a: `0` },
  { id: 4, a: `5` },
]

const sampleTrials = [
  { id: 1, productId: 1, userId: 1, createdAt: new Date() },
  { id: 2, productId: 2, userId: 1, createdAt: new Date() },
  { id: 2, productId: 4, userId: 1, createdAt: null },
  { id: 3, productId: 3, userId: 2, createdAt: new Date() },
]

function createIssuesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `join-subquery-test-issues`,
      getKey: (issue) => issue.id,
      initialData: sampleIssues,
      autoIndex,
    }),
  )
}

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `join-subquery-test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    }),
  )
}

function createProfilesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Profile>({
      id: `join-subquery-test-profiles`,
      getKey: (profile) => profile.id,
      initialData: sampleProfiles,
      autoIndex,
    }),
  )
}

function createProductsCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions({
      id: `join-subquery-test-products`,
      getKey: (product) => product.id,
      initialData: sampleProducts,
      autoIndex,
    }),
  )
}

function createTrialsCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions({
      id: `join-subquery-test-trials`,
      getKey: (item) => `${item.productId}-${item.userId}`,
      initialData: sampleTrials,
      autoIndex,
    }),
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
                `inner`,
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
                `left`,
              )
              .select(({ issue, activeUser }) => ({
                issue_title: issue.title,
                user_name: activeUser?.name,
                issue_status: issue.status,
              }))
          },
        })

        const results = joinQuery.toArray
        expect(results).toHaveLength(5) // All issues

        // Issues with active users should have user_name
        const activeUserIssues = results.filter(
          (r) => r.user_name !== undefined,
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
                `inner`,
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
      let productsCollection: ReturnType<typeof createProductsCollection>
      let trialsCollection: ReturnType<typeof createTrialsCollection>

      beforeEach(() => {
        issuesCollection = createIssuesCollection(autoIndex)
        usersCollection = createUsersCollection(autoIndex)
        productsCollection = createProductsCollection(autoIndex)
        trialsCollection = createTrialsCollection(autoIndex)
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
                `inner`,
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
                `left`,
              )
              .select(({ issue, activeUser }) => ({
                issue_title: issue.title,
                issue_status: issue.status,
                user_name: activeUser?.name,
                user_status: activeUser?.status,
              }))
          },
        })

        const results = joinQuery.toArray
        expect(results).toHaveLength(5) // All issues

        // Issues with active users should have user data
        const activeUserIssues = results.filter(
          (r) => r.user_name !== undefined,
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

      test(`should use subquery in JOIN clause - left join for trials`, () => {
        const joinSubquery = createLiveQueryCollection({
          query: (q) => {
            return q
              .from({ product: productsCollection })
              .join(
                {
                  tried: q
                    .from({ tried: trialsCollection })
                    .where(({ tried }) => eq(tried.userId, 1)),
                },
                ({ tried, product }) => eq(tried.productId, product.id),
                `left`,
              )
              .where(({ product }) => eq(product.id, 1))
              .select(({ product, tried }) => ({
                product,
                tried,
              }))
          },
          startSync: true,
        })

        const results = joinSubquery.toArray.map((row) => ({
          ...stripVirtualProps(row),
          product: stripVirtualProps(row.product),
          tried: stripVirtualProps(row.tried),
        }))
        expect(results).toHaveLength(1)
        expect(results[0]!.product.id).toBe(1)
        expect(results[0]!.tried).toBeDefined()
        expect(results[0]!.tried!.userId).toBe(1)
        expect(results[0]).toEqual({
          product: { id: 1, a: `8` },
          tried: sampleTrials[0],
        })
      })

      test(`should use subquery in LEFT JOIN clause - left join with ordered subquery with limit`, () => {
        const joinSubquery = createLiveQueryCollection({
          query: (q) => {
            return q
              .from({ issue: issuesCollection })
              .join(
                {
                  users: q
                    .from({ user: usersCollection })
                    .where(({ user }) => eq(user.status, `active`))
                    .orderBy(({ user }) => user.name, `asc`)
                    .limit(1),
                },
                ({ issue, users }) => eq(issue.userId, users.id),
                `left`,
              )
              .orderBy(({ issue }) => issue.id, `desc`)
              .limit(1)
          },
          startSync: true,
        })

        const results = joinSubquery.toArray.map((row) => ({
          ...stripVirtualProps(row),
          issue: stripVirtualProps(row.issue),
        }))
        expect(results).toEqual([
          {
            issue: {
              id: 5,
              title: `Feature 2`,
              status: `in_progress`,
              projectId: 2,
              userId: 2,
              duration: 15,
              createdAt: `2024-01-05`,
            },
          },
        ])
      })

      test(`should use subquery in RIGHT JOIN clause - left join with ordered subquery with limit`, () => {
        const joinSubquery = createLiveQueryCollection({
          query: (q) => {
            return q
              .from({
                users: q
                  .from({ user: usersCollection })
                  .where(({ user }) => eq(user.status, `active`))
                  .orderBy(({ user }) => user.name, `asc`)
                  .limit(1),
              })
              .join(
                { issue: issuesCollection },
                ({ issue, users }) => eq(issue.userId, users.id),
                `right`,
              )
              .orderBy(({ issue }) => issue.id, `desc`)
              .limit(1)
          },
          startSync: true,
        })

        const results = joinSubquery.toArray.map((row) => ({
          ...stripVirtualProps(row),
          issue: stripVirtualProps(row.issue),
        }))
        expect(results).toEqual([
          {
            issue: {
              id: 5,
              title: `Feature 2`,
              status: `in_progress`,
              projectId: 2,
              userId: 2,
              duration: 15,
              createdAt: `2024-01-05`,
            },
          },
        ])
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
                `inner`,
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

        const sortedResults = results
          .map((result) => stripVirtualProps(result))
          .sort((a, b) => a.id - b.id)
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

    describe(`nested subqueries with joins (alias remapping)`, () => {
      let issuesCollection: ReturnType<typeof createIssuesCollection>
      let usersCollection: ReturnType<typeof createUsersCollection>
      let profilesCollection: ReturnType<typeof createProfilesCollection>

      beforeEach(() => {
        issuesCollection = createIssuesCollection(autoIndex)
        usersCollection = createUsersCollection(autoIndex)
        profilesCollection = createProfilesCollection(autoIndex)
      })

      test(`should handle subquery with join used in FROM clause (tests alias remapping)`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            // Level 1: Subquery WITH a join (user + profile)
            // This creates two inner aliases: 'user' and 'profile'
            // Filter for active users at the subquery level to avoid WHERE on SELECT fields bug
            const activeUsersWithProfiles = q
              .from({ user: usersCollection })
              .join(
                { profile: profilesCollection },
                ({ user, profile }) => eq(user.id, profile.userId),
                `inner`,
              )
              .where(({ user }) => eq(user.status, `active`))
              .select(({ user, profile }) => ({
                userId: user.id,
                userName: user.name,
                userEmail: user.email,
                profileBio: profile.bio,
                profileAvatar: profile.avatar,
              }))

            // Level 2: Use the joined subquery in FROM clause
            // Outer alias: 'activeUser', inner aliases: 'user', 'profile'
            // This tests that aliasRemapping['activeUser'] = 'user' (flattened to innermost)
            return q
              .from({ activeUser: activeUsersWithProfiles })
              .join(
                { issue: issuesCollection },
                ({ activeUser, issue }) => eq(issue.userId, activeUser.userId),
                `inner`,
              )
              .select(({ activeUser, issue }) => ({
                issue_title: issue.title,
                issue_status: issue.status,
                user_name: activeUser.userName,
                user_email: activeUser.userEmail,
                profile_bio: activeUser.profileBio,
                profile_avatar: activeUser.profileAvatar,
              }))
          },
        })

        const results = joinQuery.toArray
        // Alice (id:1) and Bob (id:2) are active with profiles
        // Their issues: 1, 3 (Alice), 2, 5 (Bob) = 4 issues total
        expect(results).toHaveLength(4)

        const sortedResults = results.sort((a, b) =>
          a.issue_title.localeCompare(b.issue_title),
        )

        // Verify structure - should have both user data AND profile data
        sortedResults.forEach((result) => {
          expect(result).toHaveProperty(`issue_title`)
          expect(result).toHaveProperty(`user_name`)
          expect(result).toHaveProperty(`user_email`)
          expect(result).toHaveProperty(`profile_bio`)
          expect(result).toHaveProperty(`profile_avatar`)
        })

        // Verify Alice's issue with profile data (validates alias remapping worked)
        const aliceIssue = results.find((r) => r.issue_title === `Bug 1`)
        expect(aliceIssue).toMatchObject({
          user_name: `Alice`,
          user_email: `alice@example.com`,
          profile_bio: `Senior developer with 10 years experience`,
          profile_avatar: `alice.jpg`,
        })

        // Verify Bob's issue with profile data (validates alias remapping worked)
        const bobIssue = results.find((r) => r.issue_title === `Bug 2`)
        expect(bobIssue).toMatchObject({
          user_name: `Bob`,
          user_email: `bob@example.com`,
          profile_bio: `Full-stack engineer`,
          profile_avatar: `bob.jpg`,
        })

        // Charlie's issue should NOT appear (inactive user was filtered in subquery)
        const charlieIssue = results.find((r) => r.issue_title === `Bug 3`)
        expect(charlieIssue).toBeUndefined()
      })

      test(`should handle subquery with join used in JOIN clause (tests alias remapping)`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            // Level 1: Subquery WITH a join (user + profile)
            const usersWithProfiles = q
              .from({ user: usersCollection })
              .join(
                { profile: profilesCollection },
                ({ user, profile }) => eq(user.id, profile.userId),
                `inner`,
              )
              .where(({ user }) => eq(user.status, `active`))
              .select(({ user, profile }) => ({
                userId: user.id,
                userName: user.name,
                profileBio: profile.bio,
              }))

            // Level 2: Use the joined subquery in JOIN clause
            // Outer alias: 'author', inner aliases: 'user', 'profile'
            // This tests that aliasRemapping['author'] = 'user' for lazy loading
            return q
              .from({ issue: issuesCollection })
              .join(
                { author: usersWithProfiles },
                ({ issue, author }) => eq(issue.userId, author.userId),
                `left`,
              )
              .select(({ issue, author }) => ({
                issue_id: issue.id,
                issue_title: issue.title,
                author_name: author?.userName,
                author_bio: author?.profileBio,
              }))
          },
        })

        const results = joinQuery.toArray
        expect(results).toHaveLength(5) // All issues

        // Active users with profiles should have author data
        const withAuthors = results.filter((r) => r.author_name !== undefined)
        expect(withAuthors).toHaveLength(4) // Issues 1, 2, 3, 5 (Alice and Bob)

        // Charlie (inactive) issue should have no author data
        const charlieIssue = results.find((r) => r.issue_id === 4)
        expect(charlieIssue).toMatchObject({
          issue_title: `Bug 3`,
          author_name: undefined,
          author_bio: undefined,
        })
      })

      test(`should handle deeply nested subqueries with joins (3 levels)`, () => {
        const joinQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            // Level 1: Base joined subquery (user + profile)
            const usersWithProfiles = q
              .from({ user: usersCollection })
              .join(
                { profile: profilesCollection },
                ({ user, profile }) => eq(user.id, profile.userId),
                `inner`,
              )
              .select(({ user, profile }) => ({
                userId: user.id,
                userName: user.name,
                userStatus: user.status,
                profileBio: profile.bio,
              }))

            // Level 2: Filter the joined subquery
            const activeUsersWithProfiles = q
              .from({ userProfile: usersWithProfiles })
              .where(({ userProfile }) => eq(userProfile.userStatus, `active`))
              .select(({ userProfile }) => ({
                id: userProfile.userId,
                name: userProfile.userName,
                bio: userProfile.profileBio,
              }))

            // Level 3: Use the nested filtered joined subquery
            // Outer alias: 'author', middle alias: 'userProfile', inner aliases: 'user', 'profile'
            // Tests that aliasRemapping['author'] = 'user' (flattened to innermost, not 'userProfile')
            return q
              .from({ issue: issuesCollection })
              .join(
                { author: activeUsersWithProfiles },
                ({ issue, author }) => eq(issue.userId, author.id),
                `inner`,
              )
              .select(({ issue, author }) => ({
                issue_title: issue.title,
                author_name: author.name,
                author_bio: author.bio,
              }))
          },
        })

        const results = joinQuery.toArray
        // Only issues with active users (Alice: 1, 3 and Bob: 2, 5)
        expect(results).toHaveLength(4)

        // All results should have complete author data from the joined profiles
        results.forEach((result) => {
          expect(result.author_name).toBeDefined()
          expect(result.author_bio).toBeDefined()
          expect([
            `Senior developer with 10 years experience`,
            `Full-stack engineer`,
          ]).toContain(result.author_bio)
        })
      })
    })
  })
}

describe(`Join with Subqueries`, () => {
  createJoinSubqueryTests(`off`)
  createJoinSubqueryTests(`eager`)
})
