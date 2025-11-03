import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { issuesTable, usersTable } from '@/db/schema'
import { eq, or } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

export const Route = createFileRoute('/api/issues')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get all demo users
        const demoUsers = await context.db.query.usersTable.findMany({
          where: eq(usersTable.is_demo, true),
        })
        const demoUserIds = demoUsers.map((u) => u.id)

        // Return only issues created by the user or created by demo users
        const issues = await context.db.query.issuesTable.findMany({
          where: (issue, { inArray }) =>
            or(
              eq(issue.user_id, context.user.id),
              inArray(issue.user_id, demoUserIds)
            ),
          orderBy: (issue, { asc }) => [asc(issue.created_at)],
        })

        return json(issues)
      },
    },
  },
})
