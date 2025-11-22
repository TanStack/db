import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { issuesTable } from '@/db/schema'
import { getServerContext } from '@/server/utils'

const createIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']),
  kanbanorder: z.string(),
})

export const Route = createFileRoute('/api/issues/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const data = createIssueSchema.parse(body)

        const [issue] = await context.db
          .insert(issuesTable)
          .values({
            ...data,
            user_id: context.user.id,
            username: context.user.username,
          })
          .returning()

        return json(issue)
      },
    },
  },
})
