import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { issuesTable, usersTable } from '@/db/schema'
import { eq, or, and, inArray, SQL, sql } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

export const Route = createFileRoute('/api/issues/count')({
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

        // Parse query parameters for filtering
        const url = new URL(request.url)
        const searchParams = url.searchParams

        // Build where conditions from query parameters
        const whereConditions: SQL[] = [
          or(
            eq(issuesTable.user_id, context.user.id),
            inArray(issuesTable.user_id, demoUserIds)
          )!,
        ]

        // Handle filter parameters (same logic as /api/issues)
        for (const [key, value] of searchParams.entries()) {
          if (key.endsWith('_in')) {
            const field = key.slice(0, -3)
            const column = issuesTable[field as keyof typeof issuesTable]
            if (column) {
              const values = JSON.parse(value)
              whereConditions.push(inArray(column, values))
            }
          } else {
            const column = issuesTable[key as keyof typeof issuesTable]
            if (column) whereConditions.push(eq(column, value))
          }
        }

        // Get count
        const result = await context.db
          .select({ count: sql<number>`count(*)` })
          .from(issuesTable)
          .where(and(...whereConditions))

        return json({ count: Number(result[0]?.count ?? 0) })
      },
    },
  },
})
