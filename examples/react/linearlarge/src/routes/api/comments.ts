import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { commentsTable } from '@/db/schema'
import { eq, and, lt, lte, gt, gte, inArray, SQL, asc, desc } from 'drizzle-orm'
import { getServerContext } from '@/server/utils'

export const Route = createFileRoute('/api/comments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await getServerContext(request.headers)

        if (!context.session || !context.user) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Parse query parameters for filtering, sorting, and limiting
        const url = new URL(request.url)
        const searchParams = url.searchParams

        // Build where conditions from query parameters
        const whereConditions: SQL[] = []

        // UUID validation regex
        const isValidUUID = (str: string) => {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          return uuidRegex.test(str)
        }

        // Helper to parse value based on field type (convert ISO strings to Date for timestamp fields)
        const parseValue = (field: string, value: string) => {
          // Timestamp fields need to be converted from ISO string to Date
          if (field === 'created_at' || field === 'modified') {
            const date = new Date(value)
            return isNaN(date.getTime()) ? value : date
          }
          return value
        }

        // Handle filter parameters
        for (const [key, value] of searchParams.entries()) {
          if (key === 'sort' || key === 'limit' || key === 'offset') continue

          // Skip invalid UUID values for id, issue_id, and user_id fields
          if ((key === 'id' || key === 'issue_id' || key === 'user_id' || key.startsWith('id_') || key.startsWith('issue_id_') || key.startsWith('user_id_')) && !isValidUUID(value)) {
            console.warn(`Skipping invalid UUID for ${key}:`, value)
            continue
          }

          if (key.endsWith('_lt')) {
            const field = key.slice(0, -3)
            const column = commentsTable[field as keyof typeof commentsTable]
            if (column) whereConditions.push(lt(column, parseValue(field, value)))
          } else if (key.endsWith('_lte')) {
            const field = key.slice(0, -4)
            const column = commentsTable[field as keyof typeof commentsTable]
            if (column) whereConditions.push(lte(column, parseValue(field, value)))
          } else if (key.endsWith('_gt')) {
            const field = key.slice(0, -3)
            const column = commentsTable[field as keyof typeof commentsTable]
            if (column) whereConditions.push(gt(column, parseValue(field, value)))
          } else if (key.endsWith('_gte')) {
            const field = key.slice(0, -4)
            const column = commentsTable[field as keyof typeof commentsTable]
            if (column) whereConditions.push(gte(column, parseValue(field, value)))
          } else if (key.endsWith('_in')) {
            const field = key.slice(0, -3)
            const column = commentsTable[field as keyof typeof commentsTable]
            if (column) {
              const values = JSON.parse(value)
              whereConditions.push(inArray(column, values))
            }
          } else {
            const column = commentsTable[key as keyof typeof commentsTable]
            if (column) whereConditions.push(eq(column, parseValue(key, value)))
          }
        }

        // Parse sort parameter
        let orderByClause: any[] = [asc(commentsTable.created_at)]
        const sortParam = searchParams.get('sort')
        if (sortParam) {
          const sorts = sortParam.split(',').map((s) => {
            const [field, direction] = s.split(':')
            const column = commentsTable[field as keyof typeof commentsTable]
            return { column, direction: direction as 'asc' | 'desc' }
          })
          orderByClause = sorts
            .filter((s) => s.column)
            .map((s) => (s.direction === 'desc' ? desc(s.column) : asc(s.column)))
        }

        // Parse limit and offset parameters
        const limitParam = searchParams.get('limit')
        const limit = limitParam ? parseInt(limitParam, 10) : undefined
        const offsetParam = searchParams.get('offset')
        const offset = offsetParam ? parseInt(offsetParam, 10) : undefined

        // Build query
        let query = context.db
          .select()
          .from(commentsTable)
          .orderBy(...orderByClause)

        if (whereConditions.length > 0) {
          query = query.where(and(...whereConditions)) as any
        }

        if (limit) {
          query = query.limit(limit) as any
        }
        if (offset) {
          query = query.offset(offset) as any
        }

        // Log the SQL query with pretty printing
        const sqlQuery = query.toSQL()
        console.log('\n' + '='.repeat(80))
        console.log('💬 COMMENTS API - SQL Query')
        console.log('='.repeat(80))
        console.log('SQL:', sqlQuery.sql)
        console.log('Params:', JSON.stringify(sqlQuery.params, null, 2))
        console.log('='.repeat(80) + '\n')

        const comments = await query

        return json(comments)
      },
    },
  },
})
