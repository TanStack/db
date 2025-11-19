import * as dotenv from 'dotenv'
dotenv.config()

import { db } from './connection'
import { usersTable, issuesTable, commentsTable } from './schema'
import { generateKeyBetween } from 'fractional-indexing'

// Helper functions for generating fake data
const priorities = ['urgent', 'high', 'medium', 'low'] as const
const statuses = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const

const titlePrefixes = [
  'Implement',
  'Fix',
  'Add',
  'Update',
  'Refactor',
  'Optimize',
  'Debug',
  'Design',
  'Review',
  'Test',
  'Build',
  'Configure',
  'Migrate',
  'Improve',
  'Remove',
]

const features = [
  'authentication system',
  'API endpoints',
  'database schema',
  'user interface',
  'file upload',
  'error handling',
  'caching layer',
  'search functionality',
  'notification system',
  'dashboard',
  'reporting module',
  'permissions system',
  'data validation',
  'webhook integration',
  'export feature',
  'import tool',
  'analytics tracking',
  'email templates',
  'payment processing',
  'logging system',
  'monitoring alerts',
  'backup solution',
  'rate limiting',
  'API documentation',
  'mobile responsiveness',
  'dark mode',
  'accessibility features',
  'performance metrics',
  'security audit',
  'CI/CD pipeline',
]

const issues_verbs = [
  'crashing',
  'slow performance',
  'memory leak',
  'incorrect behavior',
  'broken layout',
  'failing tests',
  'security vulnerability',
  'missing validation',
  'race condition',
  'infinite loop',
]

const descriptions = [
  'This needs to be completed before the next release.',
  'Users have been requesting this feature for a while.',
  'Critical for production deployment.',
  'Will significantly improve user experience.',
  'Required for compliance with new regulations.',
  'Part of the Q1 roadmap.',
  'Blocking other development work.',
  'Nice to have but not urgent.',
  'Technical debt that should be addressed.',
  'Performance improvement opportunity.',
]

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function generateIssueTitle(): string {
  const useFeature = Math.random() > 0.3
  if (useFeature) {
    return `${randomElement(titlePrefixes)} ${randomElement(features)}`
  } else {
    return `Fix ${randomElement(issues_verbs)} in ${randomElement(features)}`
  }
}

function generateDescription(): string {
  const parts = [randomElement(descriptions)]
  if (Math.random() > 0.5) {
    parts.push(randomElement(descriptions))
  }
  return parts.join(' ')
}

async function seed() {
  console.log('Seeding database...')

  // Clear existing data
  console.log('Clearing existing data...')
  await db.delete(commentsTable)
  await db.delete(issuesTable)
  await db.delete(usersTable)

  // Sample names for demo users
  const sampleUsers = [
    { username: 'alice', email: 'alice@example.com', name: 'Alice Johnson' },
    { username: 'bob', email: 'bob@example.com', name: 'Bob Smith' },
    { username: 'charlie', email: 'charlie@example.com', name: 'Charlie Davis' },
    { username: 'diana', email: 'diana@example.com', name: 'Diana Martinez' },
    { username: 'eve', email: 'eve@example.com', name: 'Eve Williams' },
    { username: 'frank', email: 'frank@example.com', name: 'Frank Miller' },
    { username: 'grace', email: 'grace@example.com', name: 'Grace Lee' },
    { username: 'henry', email: 'henry@example.com', name: 'Henry Chen' },
  ]

  // Create random users
  const createdUsers = await Promise.all(
    sampleUsers.map((user) =>
      db
        .insert(usersTable)
        .values({
          id: crypto.randomUUID(),
          ...user,
          is_demo: true,
        })
        .returning()
        .then((result) => result[0])
    )
  )

  console.log(
    'Created users:',
    createdUsers.map((u) => u.username).join(', ')
  )

  // Generate 500 issues
  const ISSUE_COUNT = 500
  console.log(`Generating ${ISSUE_COUNT} issues...`)

  let kanbanorder = generateKeyBetween(null, null)
  const issues = []

  for (let i = 0; i < ISSUE_COUNT; i++) {
    const user = randomElement(createdUsers)
    issues.push({
      title: generateIssueTitle(),
      description: generateDescription(),
      priority: randomElement(priorities),
      status: randomElement(statuses),
      user_id: user.id,
      username: user.username,
      kanbanorder,
    })
    kanbanorder = generateKeyBetween(kanbanorder, null)
  }

  // Insert issues in batches for better performance
  const BATCH_SIZE = 100
  const createdIssues = []
  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE)
    const batchResult = await db.insert(issuesTable).values(batch).returning()
    createdIssues.push(...batchResult)
    console.log(`Inserted ${createdIssues.length}/${ISSUE_COUNT} issues...`)
  }

  console.log(`Created ${createdIssues.length} issues`)

  // Generate comments for random subset of issues
  console.log('Generating comments...')
  const commentBodies = [
    'Great work on this!',
    'I can help with this if needed.',
    'Should we prioritize this for the next sprint?',
    'This is blocking other work.',
    'Looking good so far!',
    'We need to discuss this in the next standup.',
    'I have some concerns about this approach.',
    'This is exactly what we need.',
    'Can we get this reviewed ASAP?',
    'I found a better solution for this.',
    'Updated the requirements in the description.',
    'Started working on this.',
    'Completed testing, ready for review.',
    'Found some edge cases we need to handle.',
    'This will require more time than estimated.',
    'Merged into main branch.',
    'We should add tests for this.',
    'Documentation updated.',
    'Good catch on that bug!',
    'Deployed to staging for testing.',
  ]

  const comments = []
  const issuesWithComments = Math.floor(createdIssues.length * 0.4)

  for (let i = 0; i < issuesWithComments; i++) {
    const issue = createdIssues[i]
    const commentCount = Math.floor(Math.random() * 4) + 1

    for (let j = 0; j < commentCount; j++) {
      const user = randomElement(createdUsers)
      comments.push({
        body: randomElement(commentBodies),
        user_id: user.id,
        username: user.username,
        issue_id: issue.id,
      })
    }
  }

  // Insert comments in batches
  if (comments.length > 0) {
    for (let i = 0; i < comments.length; i += BATCH_SIZE) {
      const batch = comments.slice(i, i + BATCH_SIZE)
      await db.insert(commentsTable).values(batch)
      console.log(`Inserted ${Math.min(i + BATCH_SIZE, comments.length)}/${comments.length} comments...`)
    }
  }

  console.log(`Created ${comments.length} comments`)

  console.log('Seeding complete!')
}

seed()
  .catch(console.error)
  .finally(() => process.exit(0))
