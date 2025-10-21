import { db } from './connection'
import { usersTable, issuesTable, commentsTable } from './schema'
import { generateKeyBetween } from 'fractional-indexing'

async function seed() {
  console.log('Seeding database...')

  // Create demo users
  const [demoUser] = await db
    .insert(usersTable)
    .values({
      username: 'demo',
      email: 'demo@example.com',
      name: 'Demo User',
    })
    .returning()

  const [testUser] = await db
    .insert(usersTable)
    .values({
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
    })
    .returning()

  console.log('Created users:', demoUser.username, testUser.username)

  // Create demo issues
  let kanbanorder = generateKeyBetween(null, null)

  const issues = [
    {
      title: 'Set up project infrastructure',
      description: 'Initialize TanStack Start project with all dependencies',
      priority: 'high' as const,
      status: 'done' as const,
      user_id: demoUser.id,
      kanbanorder,
    },
    {
      title: 'Implement issue list view',
      description: 'Create the main issue list with filtering and sorting',
      priority: 'high' as const,
      status: 'in_progress' as const,
      user_id: demoUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add kanban board',
      description: 'Implement drag-and-drop kanban board for issues',
      priority: 'medium' as const,
      status: 'todo' as const,
      user_id: demoUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Build comment system',
      description: 'Allow users to comment on issues',
      priority: 'medium' as const,
      status: 'backlog' as const,
      user_id: testUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
    {
      title: 'Add full-text search',
      description: 'Implement PostgreSQL full-text search for issues',
      priority: 'low' as const,
      status: 'backlog' as const,
      user_id: demoUser.id,
      kanbanorder: (kanbanorder = generateKeyBetween(kanbanorder, null)),
    },
  ]

  const createdIssues = await db.insert(issuesTable).values(issues).returning()
  console.log(`Created ${createdIssues.length} issues`)

  // Create demo comments
  const comments = [
    {
      body: 'Great progress on this!',
      user_id: testUser.id,
      issue_id: createdIssues[0].id,
    },
    {
      body: 'Let me know if you need any help.',
      user_id: demoUser.id,
      issue_id: createdIssues[1].id,
    },
    {
      body: 'This will be a nice feature to have.',
      user_id: testUser.id,
      issue_id: createdIssues[2].id,
    },
  ]

  await db.insert(commentsTable).values(comments)
  console.log(`Created ${comments.length} comments`)

  console.log('Seeding complete!')
}

seed()
  .catch(console.error)
  .finally(() => process.exit(0))
