import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { commentsTable, issuesTable, usersTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

export const Route = createFileRoute('/api/comments/by-issue')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const issueId = url.searchParams.get('issueId')

        if (!issueId) {
          return json({ error: 'issueId is required' }, { status: 400 })
        }

        // Verify user has access to this issue
        const issue = await context.db.query.issuesTable.findFirst({
          where: eq(issuesTable.id, issueId),
        })

        if (!issue) {
          return json({ error: 'Issue not found' }, { status: 404 })
        }

        // User can see comments if they own the issue or it's a demo issue
        if (issue.user_id !== context.user.id) {
          // Check if it's a demo issue by checking the user
          const issueUser = await context.db.query.usersTable.findFirst({
            where: eq(usersTable.id, issue.user_id),
          })
          if (!issueUser || !issueUser.is_demo) {
            return json({ error: 'Unauthorized' }, { status: 403 })
          }
        }

        const comments = await context.db.query.commentsTable.findMany({
          where: eq(commentsTable.issue_id, issueId),
          orderBy: (comments, { asc }) => [asc(comments.created_at)],
        })

        return json(comments)
      },
    },
  },
})
