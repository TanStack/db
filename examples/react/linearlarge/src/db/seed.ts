import * as dotenv from 'dotenv'
dotenv.config()

import { db } from './connection'
import { usersTable, issuesTable, commentsTable } from './schema'
import { generateKeyBetween } from 'fractional-indexing'

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

  const [alice, bob, charlie, diana] = createdUsers

  console.log(
    'Created users:',
    createdUsers.map((u) => u.username).join(', ')
  )

  // Create demo issues
  let kanbanorder = generateKeyBetween(null, null)

  const issues = [
    {
      title: 'Set up project infrastructure',
      description: 'Initialize TanStack Start project with all dependencies',
      priority: 'high' as const,
      status: 'done' as const,
      user_id: alice.id,
      username: alice.username,
      kanbanorder,
    },
    {
      title: 'Implement issue list view',
      description: 'Create the main issue list with filtering and sorting',
      priority: 'high' as const,
      status: 'in_progress' as const,
      user_id: bob.id,
      username: bob.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add kanban board',
      description: 'Implement drag-and-drop kanban board for issues',
      priority: 'medium' as const,
      status: 'todo' as const,
      user_id: alice.id,
      username: alice.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Build comment system',
      description: 'Allow users to comment on issues',
      priority: 'medium' as const,
      status: 'backlog' as const,
      user_id: charlie.id,
      username: charlie.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add full-text search',
      description: 'Implement PostgreSQL full-text search for issues',
      priority: 'low' as const,
      status: 'backlog' as const,
      user_id: diana.id,
      username: diana.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Optimize database queries',
      description: 'Add indexes and optimize slow queries',
      priority: 'medium' as const,
      status: 'todo' as const,
      user_id: bob.id,
      username: bob.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add user authentication',
      description: 'Implement proper user authentication system',
      priority: 'urgent' as const,
      status: 'in_progress' as const,
      user_id: alice.id,
      username: alice.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Write documentation',
      description: 'Create comprehensive documentation for the API',
      priority: 'low' as const,
      status: 'backlog' as const,
      user_id: charlie.id,
      username: charlie.username,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
  ]

  const createdIssues = await db.insert(issuesTable).values(issues).returning()
  console.log(`Created ${createdIssues.length} issues`)

  // Create demo comments
  const comments = [
    {
      body: 'Great work on getting the infrastructure set up! 🎉',
      user_id: bob.id,
      username: bob.username,
      issue_id: createdIssues[0].id,
    },
    {
      body: 'I can help with the filtering logic if needed.',
      user_id: alice.id,
      username: alice.username,
      issue_id: createdIssues[1].id,
    },
    {
      body: 'Should we use @dnd-kit for this?',
      user_id: charlie.id,
      username: charlie.username,
      issue_id: createdIssues[2].id,
    },
    {
      body: 'Yes, @dnd-kit is perfect for drag and drop!',
      user_id: bob.id,
      username: bob.username,
      issue_id: createdIssues[2].id,
    },
    {
      body: 'This will be really useful for the team.',
      user_id: diana.id,
      username: diana.username,
      issue_id: createdIssues[3].id,
    },
    {
      body: 'We should prioritize this for the next sprint.',
      user_id: alice.id,
      username: alice.username,
      issue_id: createdIssues[6].id,
    },
  ]

  await db.insert(commentsTable).values(comments)
  console.log(`Created ${comments.length} comments`)

  console.log('Seeding complete!')
}

seed()
  .catch(console.error)
  .finally(() => process.exit(0))
