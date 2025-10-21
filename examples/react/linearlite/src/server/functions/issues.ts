import { createServerFn } from '@tanstack/start/server'
import { z } from 'zod'
import { issuesTable } from '@/db/schema'
import { eq, or } from 'drizzle-orm'
import { getServerContext, requireAuth } from '../utils'

// Get all issues for the current user
export const getAllIssues = createServerFn({ method: 'GET' }).handler(
  async ({ request }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    // Return only issues created by the user or pre-seeded demo data
    const issues = await context.db.query.issuesTable.findMany({
      where: (issues, { eq, or }) =>
        or(
          eq(issues.user_id, context.user.id),
          // Allow access to demo user's issues for all users
          eq(issues.username, 'demo')
        ),
      orderBy: (issues, { asc }) => [asc(issues.created_at)],
    })

    return issues
  }
)

// Create issue input schema
const createIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']),
  kanbanorder: z.string(),
})

export const createIssue = createServerFn({ method: 'POST' })
  .validator(createIssueSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    const [issue] = await context.db
      .insert(issuesTable)
      .values({
        ...data,
        user_id: context.user.id,
      })
      .returning()

    return issue
  })

// Update issue input schema
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

export const updateIssue = createServerFn({ method: 'POST' })
  .validator(updateIssueSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    const { id, ...updates } = data

    // Verify ownership
    const existing = await context.db.query.issuesTable.findFirst({
      where: eq(issuesTable.id, id),
    })

    if (!existing || existing.user_id !== context.user.id) {
      throw new Error('Unauthorized')
    }

    const [updated] = await context.db
      .update(issuesTable)
      .set({
        ...updates,
        modified: new Date(),
      })
      .where(eq(issuesTable.id, id))
      .returning()

    return updated
  })

// Delete issue input schema
const deleteIssueSchema = z.object({ id: z.string().uuid() })

export const deleteIssue = createServerFn({ method: 'POST' })
  .validator(deleteIssueSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    // Verify ownership
    const existing = await context.db.query.issuesTable.findFirst({
      where: eq(issuesTable.id, data.id),
    })

    if (!existing || existing.user_id !== context.user.id) {
      throw new Error('Unauthorized')
    }

    await context.db.delete(issuesTable).where(eq(issuesTable.id, data.id))

    return { success: true }
  })
