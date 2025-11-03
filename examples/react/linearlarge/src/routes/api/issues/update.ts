import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { issuesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
  status: z
    .enum(['backlog', 'todo', 'in_progress', 'done', 'canceled'])
    .optional(),
  kanbanorder: z.string().optional(),
})

export const Route = createFileRoute('/api/issues/update')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const data = updateIssueSchema.parse(body)
        const { id, ...updates } = data

        // Verify ownership
        const existing = await context.db.query.issuesTable.findFirst({
          where: eq(issuesTable.id, id),
        })

        if (!existing || existing.user_id !== context.user.id) {
          return json({ error: 'Unauthorized' }, { status: 403 })
        }

        const [updated] = await context.db
          .update(issuesTable)
          .set({
            ...updates,
            modified: new Date(),
          })
          .where(eq(issuesTable.id, id))
          .returning()

        return json(updated)
      },
    },
  },
})
