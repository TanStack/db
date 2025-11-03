import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { commentsTable } from '@/db/schema'
import { getServerContext } from '@/server/utils'

export const Route = createFileRoute('/api/comments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get all comments from issues the user has access to
        const comments = await context.db.query.commentsTable.findMany({
          orderBy: (comment, { asc }) => [asc(comment.created_at)],
        })

        return json(comments)
      },
    },
  },
})
