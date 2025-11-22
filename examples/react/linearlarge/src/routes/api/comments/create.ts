import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { commentsTable, issuesTable, usersTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

const createCommentSchema = z.object({
  body: z.string().min(1),
  issue_id: z.string().uuid(),
})

export const Route = createFileRoute('/api/comments/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const data = createCommentSchema.parse(body)

        // Verify user has access to this issue
        const issue = await context.db.query.issuesTable.findFirst({
          where: eq(issuesTable.id, data.issue_id),
        })

        if (!issue) {
          return json({ error: 'Issue not found' }, { status: 404 })
        }

        // User can comment if they own the issue or it's a demo issue
        if (issue.user_id !== context.user.id) {
          // Check if it's a demo issue by checking the user
          const issueUser = await context.db.query.usersTable.findFirst({
            where: eq(usersTable.id, issue.user_id),
          })
          if (!issueUser || !issueUser.is_demo) {
            return json({ error: 'Unauthorized' }, { status: 403 })
          }
        }

        const [comment] = await context.db
          .insert(commentsTable)
          .values({
            ...data,
            user_id: context.user.id,
            username: context.user.username,
          })
          .returning()

        return json(comment)
      },
    },
  },
})
