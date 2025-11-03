import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { selectIssueSchema, selectCommentSchema } from '@/db/schema'

export const queryClient = new QueryClient()

export const issuesQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'issues-query',
    queryKey: ['issues'],
    refetchInterval: 3000, // Poll every 3 seconds
    queryClient,

    queryFn: async () => {
      const response = await fetch('/api/issues')
      const issues = await response.json()
      return issues.map((issue) => ({
        ...issue,
        created_at: new Date(issue.created_at),
        modified: new Date(issue.modified),
      }))
    },

    getKey: (item) => item.id,
    schema: selectIssueSchema,

    onInsert: async ({ transaction }) => {
      const newIssue = transaction.mutations[0].modified
      await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newIssue.title,
          description: newIssue.description,
          priority: newIssue.priority,
          status: newIssue.status,
          kanbanorder: newIssue.kanbanorder,
        }),
      })
    },

    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map(async (mutation) => {
          // Only send fields that are allowed to be updated
          const allowedChanges: Record<string, any> = {}
          const allowedFields = [
            'title',
            'description',
            'priority',
            'status',
            'kanbanorder',
          ]

          for (const field of allowedFields) {
            if (field in mutation.changes) {
              allowedChanges[field] = mutation.changes[field]
            }
          }

          return fetch('/api/issues/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: mutation.original.id,
              ...allowedChanges,
            }),
          })
        })
      )
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          fetch('/api/issues/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: mutation.original.id }),
          })
        )
      )
    },
  })
)

export const commentsQueryCollection = createCollection(
  queryCollectionOptions({
    id: 'comments-query',
    queryKey: ['comments'],
    refetchInterval: 3000,
    queryClient,

    queryFn: async () => {
      const response = await fetch('/api/comments')
      const comments = await response.json()
      return comments.map((comment) => ({
        ...comment,
        created_at: new Date(comment.created_at),
        modified: new Date(comment.modified),
      }))
    },

    getKey: (item) => item.id,
    schema: selectCommentSchema,

    onInsert: async ({ transaction }) => {
      const newComment = transaction.mutations[0].modified
      await fetch('/api/comments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: newComment.body,
          issue_id: newComment.issue_id,
        }),
      })
    },

    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((mutation) =>
          fetch('/api/comments/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: mutation.original.id }),
          })
        )
      )
    },
  })
)
