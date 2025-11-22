import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { commentsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

const deleteCommentSchema = z.object({ id: z.string().uuid() })

export const Route = createFileRoute('/api/comments/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const data = deleteCommentSchema.parse(body)

        // Verify ownership
        const existing = await context.db.query.commentsTable.findFirst({
          where: eq(commentsTable.id, data.id),
        })

        if (!existing || existing.user_id !== context.user.id) {
          return json({ error: 'Unauthorized' }, { status: 403 })
        }

        await context.db.delete(commentsTable).where(eq(commentsTable.id, data.id))

        return json({ success: true })
      },
    },
  },
})
