import { createServerFn } from '@tanstack/start/server'
import { z } from 'zod'
import { commentsTable, issuesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getServerContext } from '../utils'

// Get comments by issue ID input schema
const getCommentsByIssueIdSchema = z.object({ issueId: z.string().uuid() })

export const getCommentsByIssueId = createServerFn({ method: 'GET' })
  .validator(getCommentsByIssueIdSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    // Verify user has access to this issue
    const issue = await context.db.query.issuesTable.findFirst({
      where: eq(issuesTable.id, data.issueId),
    })

    if (!issue) {
      throw new Error('Issue not found')
    }

    // User can see comments if they can see the issue
    if (issue.user_id !== context.user.id) {
      // Check if it's a demo issue
      const isDemoIssue = issue.user_id === 'demo'
      if (!isDemoIssue) {
        throw new Error('Unauthorized')
      }
    }

    return context.db.query.commentsTable.findMany({
      where: eq(commentsTable.issue_id, data.issueId),
      orderBy: (comments, { asc }) => [asc(comments.created_at)],
    })
  })

// Create comment input schema
const createCommentSchema = z.object({
  body: z.string().min(1),
  issue_id: z.string().uuid(),
})

export const createComment = createServerFn({ method: 'POST' })
  .validator(createCommentSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    // Verify user has access to this issue
    const issue = await context.db.query.issuesTable.findFirst({
      where: eq(issuesTable.id, data.issue_id),
    })

    if (!issue || issue.user_id !== context.user.id) {
      throw new Error('Unauthorized')
    }

    const [comment] = await context.db
      .insert(commentsTable)
      .values({
        ...data,
        user_id: context.user.id,
      })
      .returning()

    return comment
  })

// Delete comment input schema
const deleteCommentSchema = z.object({ id: z.string().uuid() })

export const deleteComment = createServerFn({ method: 'POST' })
  .validator(deleteCommentSchema)
  .handler(async ({ request, data }) => {
    const context = await getServerContext(request.headers)

    if (!context.session || !context.user) {
      throw new Error('Unauthorized')
    }

    // Verify ownership
    const existing = await context.db.query.commentsTable.findFirst({
      where: eq(commentsTable.id, data.id),
    })

    if (!existing || existing.user_id !== context.user.id) {
      throw new Error('Unauthorized')
    }

    await context.db.delete(commentsTable).where(eq(commentsTable.id, data.id))

    return { success: true }
  })
